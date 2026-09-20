// The photoatomic cross sections `element.arrow` carries, by MT, with the
// column each one is stored in and the name the table shows. MT 501, the
// total, is not published, and neither is 516 (total pair production).
//
// The incident particle is spelled `gamma` rather than γ, which is how ENDF
// already names neutron capture here, `(n,gamma)`. A name in the table is
// also a name to type into the filter, and no keyboard has a γ.

export const PHOTON_MTS = Object.freeze({
  502: { column: 'coherent_xs', name: '(gamma,coherent)' },
  504: { column: 'incoherent_xs', name: '(gamma,incoherent)' },
  515: { column: 'pair_production_electron_xs', name: '(gamma,pair production, electron field)' },
  517: { column: 'pair_production_nuclear_xs', name: '(gamma,pair production, nuclear field)' },
  522: { column: 'photoelectric_xs', name: '(gamma,photoelectric)' },
});

/// True for an MT that is a photon reaction rather than a neutron one.
export function isPhotonMt(mt) {
  return Object.hasOwn(PHOTON_MTS, mt);
}
