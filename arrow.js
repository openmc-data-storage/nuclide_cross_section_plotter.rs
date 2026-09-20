// Decoding the published Arrow files, in the worker and under Node.
//
// Every section is Arrow IPC with LZ4-frame compressed record batch bodies.
// apache-arrow reads those once a codec is registered for the compression
// type: it strips the 8-byte length prefix of each buffer itself and hands the
// frame to `decode`. The same reader accepts a whole file (ARROW1 magic and a
// footer) and the spliced streams `ranges.js` builds (schema, batches, EOS),
// sniffing which it was given.
//
// The decoder is built from the two libraries rather than importing them
// here, so the worker can pass the CDN builds and the tests the npm packages.

/// Build the decoder. `arrow` is the apache-arrow module, `lz4Decompress` a
/// function from LZ4 frame bytes to the decompressed bytes.
export function createArrowDecoder(arrow, lz4Decompress) {
  const { compressionRegistry, CompressionType, RecordBatchReader } = arrow;
  compressionRegistry.set(CompressionType.LZ4_FRAME, {
    decode: (bytes) => lz4Decompress(bytes),
  });

  /// Every record batch in `bytes`, whole file or spliced stream.
  function readBatches(bytes) {
    return [...RecordBatchReader.from(bytes)];
  }

  function column(batch, name) {
    const vector = batch.getChild(name);
    if (!vector) throw new Error(`column ${name} is not in this batch`);
    return vector;
  }

  /// A scalar cell.
  function scalar(batch, name, row = 0) {
    return column(batch, name).get(row);
  }

  /// A `list<f64>` cell as a Float64Array (a view where the library allows).
  function f64List(batch, name, row = 0) {
    const list = column(batch, name).get(row);
    return list ? Float64Array.from(list.toArray()) : new Float64Array(0);
  }

  /// One inner list of a `list<list<f64>>` cell as a Float64Array.
  function f64ListList(batch, name, row = 0, inner = 0) {
    const outer = column(batch, name).get(row);
    const list = outer ? outer.get(inner) : null;
    return list ? Float64Array.from(list.toArray()) : new Float64Array(0);
  }

  /// A `list<T>` cell of scalars (utf8, int) as a plain array.
  function scalarList(batch, name, row = 0) {
    const list = column(batch, name).get(row);
    return list ? Array.from(list.toArray ? list.toArray() : list) : [];
  }

  return { readBatches, scalar, f64List, f64ListList, scalarList };
}

/// Decode one reaction record batch into a series.
///
/// A published batch is one MT at one temperature, so the list columns have a
/// single entry. The cross section starts at `threshold` on the nuclide's
/// union energy grid for that temperature, which is why the grid is passed in.
export function reactionSeries(decoder, batch, grid) {
  const mt = decoder.scalar(batch, 'mt');
  const label = decoder.scalar(batch, 'label');
  const temperature = decoder.scalarList(batch, 'xs_temperatures')[0];
  const xs = decoder.f64ListList(batch, 'xs_values', 0, 0);
  const threshold = decoder.scalarList(batch, 'xs_threshold_idx')[0] ?? 0;
  const energy = grid.subarray(threshold);
  if (energy.length !== xs.length) {
    throw new Error(
      `MT ${mt} at ${temperature}: ${xs.length} cross section points against ` +
      `${energy.length} grid points from threshold ${threshold}`);
  }
  return { mt, label, temperature, threshold, energy, xs };
}

/// Decode an `energy.arrow` batch: `{temperature, grid}`.
export function energyGrid(decoder, batch) {
  return {
    temperature: decoder.scalar(batch, 'temperature'),
    grid: decoder.f64List(batch, 'energy_values'),
  };
}
