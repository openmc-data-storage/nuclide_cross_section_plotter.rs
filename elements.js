// Element symbols by atomic number, copied from core's `endf` crate
// (`crates/endf/src/data.rs`, `ATOMIC_SYMBOL`). Z = 0 is the neutron, which
// the libraries really do publish (JENDL ships a neutron material).

export const ATOMIC_SYMBOL = Object.freeze([
  'n', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F',
  'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K',
  'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu',
  'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y',
  'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In',
  'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr',
  'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm',
  'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au',
  'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac',
  'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es',
  'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt',
  'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
]);

const Z_OF = new Map(ATOMIC_SYMBOL.map((s, z) => [s, z]));

/// The atomic number of a symbol, or undefined.
export function zOf(symbol) {
  return Z_OF.get(symbol);
}

const NUCLIDE_RE = /^([A-Z][a-z]?)(\d+)(?:_m(\d+))?$/;
const ELEMENT_RE = /^[A-Z][a-z]?$/;

/// Split a published directory name into its parts.
///
/// `Fe56` -> `{element: 'Fe', z: 26, a: 56, meta: 0}`, `Am242_m1` has
/// `meta: 1`, and a bare element symbol such as `Fe` (a photon directory) has
/// `a: 0`. Returns null for anything else, including unknown symbols.
export function parseNuclide(name) {
  let m = NUCLIDE_RE.exec(name);
  if (m) {
    const z = zOf(m[1]);
    if (z === undefined) return null;
    return { element: m[1], z, a: Number(m[2]), meta: m[3] ? Number(m[3]) : 0 };
  }
  if (ELEMENT_RE.test(name)) {
    const z = zOf(name);
    if (z === undefined) return null;
    return { element: name, z, a: 0, meta: 0 };
  }
  return null;
}

/// How the table shows the mass number: `56`, `242 m1`, or blank for an element.
export function nucleonsLabel(a, meta) {
  if (!a) return '';
  return meta ? `${a} m${meta}` : String(a);
}
