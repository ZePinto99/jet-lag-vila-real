import type { Locale } from '@/lib/i18n/messages'

type CatalogField =
  | 'name'
  | 'description'
  | 'reveals'
  | 'task'
  | 'location_name'

type PortugueseCatalogEntry = Partial<Record<CatalogField, string>>

// The seed catalogs remain the server-side source of truth in English. This
// table supplies presentation-only PT-PT copy without changing stable refs or
// event payloads stored in existing games.
const PT_CATALOG: Record<string, PortugueseCatalogEntry> = {
  'intel.north-south': {
    name: 'Norte/Sul',
    reveals: 'Indica se a bandeira verdadeira fica a norte ou a sul da linha média fixa do conjunto completo de candidatos adversários',
  },
  // HISTORICAL ONLY — 'intel.east-west' was retired from data/intel.json and is
  // no longer purchasable, so `reveals` (purchase-panel copy) is gone. `name` is
  // kept so a card held by a pre-removal game still renders a PT title instead
  // of the raw ref. See RETIRED_INTEL_NAMES in components/game/IntelCardDisplay.
  'intel.east-west': {
    name: 'Este/Oeste',
  },
  'intel.eliminate-one': {
    name: 'Eliminar Uma',
    reveals: 'Identifica um dos 5 locais candidatos que não tem a bandeira verdadeira',
  },
  'intel.eliminate-two': {
    name: 'Eliminar Duas',
    reveals: 'Identifica dois locais candidatos que não têm a bandeira verdadeira',
  },
  'intel.decoy-reveal': {
    name: 'Revelar Engano',
    reveals: 'Identifica um dos dois enganos (não revela a bandeira verdadeira)',
  },
  'intel.hot-cold': {
    name: 'Quente/Frio',
    reveals: 'Mostra a faixa de distância entre o teu GPS e a bandeira verdadeira (<200 m / <500 m / <1 km / mais longe)',
  },
  'intel.surroundings': {
    name: 'Arredores',
    reveals: 'Mostra uma foto dos arredores tirada a menos de 30 m da bandeira verdadeira, sem o marcador visível',
  },
  'intel.direction': {
    name: 'Direção',
    reveals: 'Mostra a direção geral da bandeira verdadeira a partir do centro da cidade (N / E / S / O)',
  },

  'curse.slow-walk': {
    name: 'Passo Lento',
    description: 'Durante 5 min, a velocidade média fica abaixo de 2,5 km/h; a app mostra um aviso assistido por GPS e o cumprimento é por honra',
  },
  'curse.single-file': {
    name: 'Fila Indiana',
    description: 'Durante 5 min, a equipa caminha em fila indiana; a app pede duas fotos de grupo tiradas pela frente',
  },
  'curse.photo-tax': {
    name: 'Taxa Fotográfica',
    description: 'Durante 6 min, tira uma selfie junto a uma placa a cada 2 min (cerca de 3 provas)',
  },
  'curse.check-in': {
    name: 'Check-in',
    description: 'Durante 10 min, cada jogador afetado confirma um aviso da app a cada 2 min (cerca de 5 toques); por honra, sem bloqueio automático',
  },
  'curse.detour': {
    name: 'Desvio',
    description: 'Durante 15 min, evita uma rua escolhida pela app; o GPS mostra um aviso de proximidade e o cumprimento é por honra',
  },
  'curse.buddy-up': {
    name: 'Sempre Juntos',
    description: 'Durante 15 min, todos os membros da equipa ficam a menos de 25 m uns dos outros; o GPS mostra a dispersão em direto',
  },
  'curse.outfit-swap': {
    name: 'Troca de Roupa',
    description: 'Troca uma peça de roupa com um colega e usa-a durante 20 min; são necessárias fotos antes e depois',
  },
  'curse.mute': {
    name: 'Silêncio',
    description: 'Durante 15 min, só podem comunicar por escrito no chat da app; a app confirma a cada minuto',
  },
  'curse.backwards': {
    name: 'De Costas',
    description: 'Durante 10 min, tens de caminhar de costas (um colega pode guiar-te); regra de honra',
  },
  'curse.pose-patrol': {
    name: 'Patrulha de Poses',
    description: 'Durante 12 min, a app envia uma pose a cada 2 min que deve ser fotografada em 30 s',
  },
  'curse.frozen': {
    name: 'Congelados',
    description: 'Durante 8 min, todos os membros ficam a menos de 10 m da posição inicial; o GPS mostra o desvio em direto',
  },
  'curse.pilgrimage': {
    name: 'Peregrinação',
    description: 'Caminha até ao local neutro indicado antes de qualquer outra ação; validado por GPS',
  },
  'curse.coin-drain': {
    name: 'Dreno de Moedas',
    description: 'Perde imediatamente 50 moedas',
  },
  'curse.intel-loss': {
    name: 'Perda de Intel',
    description: 'Descarta uma carta de intel ao acaso',
  },
  'curse.solo-quarantine': {
    name: 'Quarentena de Equipa',
    description: 'Durante 15 min, todos os membros da equipa ficam a menos de 10 m uns dos outros; o GPS mostra a dispersão em direto',
  },
  'curse.full-stop': {
    name: 'Paragem Total',
    description: 'Durante 10 min, nenhuma ação da app é permitida (compras, apanhas ou submissões de desafios)',
  },

  'placed.snare': {
    name: 'Armadilha Congelante',
    description: 'Apanha um inimigo que entre neste local — a equipa fica congelada no lugar durante 8 minutos.',
  },
  'placed.slow-trap': {
    name: 'Armadilha Lenta',
    description: 'Um inimigo que entre aqui abranda toda a equipa para passo lento durante 5 minutos.',
  },
  'placed.quarantine-field': {
    name: 'Campo de Quarentena',
    description: 'Um inimigo que entre aqui junta toda a equipa — todos têm de ficar a menos de 10 m uns dos outros durante 15 minutos.',
  },

  'challenge.se-cathedral-date': {
    task: 'Fotografa a data gravada na fachada principal',
  },
  'challenge.largo-pelourinho-cardinals': {
    task: 'Fotografa o pelourinho completo numa só foto',
  },
  'challenge.avenida-statue-inscription': {
    location_name: 'Igreja de São Pedro',
    task: 'Fotografa a fachada principal completa com a entrada visível',
  },
  'challenge.igreja-dos-clerigos-windows': {
    task: 'Conta as janelas visíveis da rua e submete o número',
  },
  'challenge.diogo-cao-plaque': {
    task: 'Fotografa a placa comemorativa',
  },
  'challenge.utad-botanical-latin-name': {
    task: 'Fotografa os dois vales a partir do miradouro e identifica os rios Cabril e Corgo',
  },
  'challenge.utad-library-entrance': {
    task: 'Fotografa a placa do miradouro com o horizonte de Vila Real ao fundo',
  },
  'challenge.mercado-price-sign': {
    location_name: 'Capela de São Lázaro',
    task: 'Fotografa a fachada principal completa com a entrada visível',
  },
  'challenge.train-station-clock': {
    location_name: 'Jardim da Carreira',
    task: 'Fotografa a estátua de Camilo Castelo Branco com a placa identificativa visível',
  },
  'challenge.nosso-shopping-storefront': {
    task: 'Fotografa a fachada exterior com o letreiro Nosso Shopping visível',
  },
  'challenge.ponte-metalica-river': {
    task: 'Fotografa o rio a partir do meio da ponte',
  },
  'challenge.teatro-playbill': {
    task: 'Fotografa a entrada permanente com o nome Teatro de Vila Real visível',
  },
  'challenge.camara-municipal-flag': {
    task: 'Fotografa a fachada municipal com o nome do edifício visível',
  },
  'challenge.pastel-de-nata-quote': {
    location_name: 'Qualquer local',
    task: 'Compra e come um pastel de nata; submete uma foto de um colega a dar uma dentada',
  },
  'challenge.parque-florestal-birds': {
    task: 'Fotografa duas folhas visivelmente diferentes lado a lado numa só foto',
  },
}

export function localizeCatalogField(
  ref: string,
  field: CatalogField,
  fallback: string,
  locale: Locale,
): string {
  if (locale !== 'pt') return fallback
  return PT_CATALOG[ref]?.[field] ?? fallback
}
