// The photoatomic cross sections `element.arrow` carries, by MT, with the
// column each one is stored in and the name the table shows. MT 501, the
// total, is not published, and neither is 516 (total pair production).

export const PHOTON_MTS = Object.freeze({
  502: { column: 'coherent_xs', name: '(γ,coherent)' },
  504: { column: 'incoherent_xs', name: '(γ,incoherent)' },
  515: { column: 'pair_production_electron_xs', name: '(γ,pair production, electron field)' },
  517: { column: 'pair_production_nuclear_xs', name: '(γ,pair production, nuclear field)' },
  522: { column: 'photoelectric_xs', name: '(γ,photoelectric)' },
});

/// True for an MT that is a photon reaction rather than a neutron one.
export function isPhotonMt(mt) {
  return Object.hasOwn(PHOTON_MTS, mt);
}
