// Static translation table for the app UI. Add new keys here in en/pt pairs.
// Dialect: Portuguese of Portugal (PT-PT). Use informal "tu" for gameplay
// surfaces — friend-game context, not corporate.

export type Locale = 'en' | 'pt'
export const LOCALES: ReadonlyArray<Locale> = ['en', 'pt']
export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'EN',
  pt: 'PT',
}

export const LOCALE_FULL: Record<Locale, string> = {
  en: 'English',
  pt: 'Português',
}

type MessageDict = Record<string, Record<Locale, string>>

export const MESSAGES: MessageDict = {
  // ---------- landing / form ----------
  'landing.tagline': {
    en: 'Walking-only capture the flag. The app is the referee.',
    pt: 'Captura a bandeira só a pé. A app é o árbitro.',
  },
  'landing.create_game': { en: 'Create game', pt: 'Criar jogo' },
  'landing.create_game_desc': {
    en: 'Start a new session and invite your team',
    pt: 'Inicia uma nova sessão e convida a tua equipa',
  },
  'landing.rejoin_game': { en: 'Rejoin last game', pt: 'Voltar ao último jogo' },
  'landing.rejoin_game_desc': {
    en: 'Continue game {code}',
    pt: 'Continuar o jogo {code}',
  },
  'landing.join_game': { en: 'Join game', pt: 'Entrar num jogo' },
  'landing.join_game_desc': {
    en: 'Enter a 4-letter code to join an existing session',
    pt: 'Introduz um código de 4 letras para entrar numa sessão',
  },

  // ---------- common buttons / state ----------
  'common.ready': { en: 'Ready', pt: 'Pronto' },
  'common.not_ready': { en: 'Not ready', pt: 'Não pronto' },
  'common.saving': { en: 'Saving…', pt: 'A guardar…' },
  'common.cancel': { en: 'Cancel', pt: 'Cancelar' },
  'common.confirm': { en: 'Confirm', pt: 'Confirmar' },
  'common.submit': { en: 'Submit', pt: 'Submeter' },
  'common.close': { en: 'Close', pt: 'Fechar' },
  'common.dismiss': { en: 'Dismiss', pt: 'Dispensar' },
  'common.back_to_home': { en: 'Back to home', pt: 'Voltar ao início' },
  'common.loading': { en: 'Loading…', pt: 'A carregar…' },
  'common.you': { en: 'you', pt: 'tu' },
  'common.team': { en: 'Team', pt: 'Equipa' },
  'common.west': { en: 'West', pt: 'Oeste' },
  'common.east': { en: 'East', pt: 'Este' },
  'common.coins': { en: 'coins', pt: 'moedas' },
  'common.real': { en: 'Real', pt: 'Verdadeira' },
  'common.decoy': { en: 'Decoy', pt: 'Engano' },
  'common.empty': { en: 'Empty', pt: 'Vazia' },
  'common.host': { en: 'host', pt: 'anfitrião' },
  'common.expired': { en: 'expired', pt: 'expirada' },
  'common.unknown_error': { en: 'unknown error', pt: 'erro desconhecido' },

  // ---------- lobby ----------
  'lobby.title': { en: 'Lobby', pt: 'Sala de espera' },
  'lobby.share_hint': {
    en: 'Share the code with the other players. Game starts when everyone is ready.',
    pt: 'Partilha o código com os outros jogadores. O jogo começa quando todos estiverem prontos.',
  },
  'lobby.team_west_full': {
    en: 'Team West (Vila Velha)',
    pt: 'Equipa Oeste (Vila Velha)',
  },
  'lobby.team_east_full': { en: 'Team East (Biblioteca)', pt: 'Equipa Este (Biblioteca)' },
  'lobby.no_players': { en: 'No players yet.', pt: 'Ainda sem jogadores.' },
  'lobby.team_not_initialised': { en: 'Team not initialised yet…', pt: 'Equipa ainda não inicializada…' },
  'lobby.players_one': { en: '1 player', pt: '1 jogador' },
  'lobby.players_many': { en: '{n} players', pt: '{n} jogadores' },
  'lobby.you_are': { en: 'You are', pt: 'Tu és' },
  'lobby.on_side_west': { en: 'On West', pt: 'No Oeste' },
  'lobby.on_side_east': { en: 'On East', pt: 'no Este' },
  'lobby.switch_team': { en: 'Switch to other team', pt: 'Mudar de equipa' },
  'lobby.switching': { en: 'Switching…', pt: 'A mudar…' },
  'lobby.start_game': { en: 'Start game', pt: 'Começar jogo' },
  'lobby.starting': { en: 'Starting…', pt: 'A começar…' },
  'lobby.need_both_teams': { en: 'Both teams need at least one player.', pt: 'Ambas as equipas precisam de pelo menos um jogador.' },
  'lobby.need_team_sizes': {
    en: 'Teams must be equal, with 1–4 players on each side.',
    pt: 'As equipas têm de ser iguais, com 1–4 jogadores de cada lado.',
  },
  'lobby.other_team_full': {
    en: 'The other team is full (4 players).',
    pt: 'A outra equipa está cheia (4 jogadores).',
  },
  'lobby.need_all_ready': { en: 'All players must mark ready.', pt: 'Todos os jogadores têm de marcar pronto.' },
  'lobby.leave': { en: 'Leave game', pt: 'Sair do jogo' },
  'lobby.leaving': { en: 'Leaving…', pt: 'A sair…' },
  'lobby.kick_confirm': { en: 'Remove this player from the game?', pt: 'Remover este jogador do jogo?' },
  'lobby.leave_confirm': { en: 'Leave this game?', pt: 'Sair deste jogo?' },
  'lobby.kick_title': { en: 'Remove player?', pt: 'Remover jogador?' },
  'lobby.leave_title': { en: 'Leave game?', pt: 'Sair do jogo?' },
  'lobby.kick_action': { en: 'Remove', pt: 'Remover' },
  'lobby.leave_action': { en: 'Leave', pt: 'Sair' },
  'lobby.not_in_game': { en: 'You are not in this game.', pt: 'Não estás neste jogo.' },
  'lobby.join_this_game': { en: 'Join this game', pt: 'Entrar neste jogo' },

  // ---------- setup ----------
  'setup.title': { en: 'Setup phase', pt: 'Fase de preparação' },
  'setup.waiting_other': { en: 'Waiting for the other team…', pt: 'À espera da outra equipa…' },
  'setup.assignment_locked': {
    en: "Your team's flag assignment is locked in.",
    pt: 'A escolha da tua equipa está fechada.',
  },
  'setup.intro_pt1': { en: 'You are Team', pt: 'Tu és da Equipa' },
  'setup.intro_pt2': {
    en: '. Walk to your home base with your team. When you are all there, decide together: 5 candidate landmarks — 1 real flag, 2 decoys, 2 empty.',
    pt: '. Caminhem até à base da equipa. Quando estiverem todos lá, decidam em conjunto: 5 marcos candidatos — 1 bandeira real, 2 enganos, 2 vazios.',
  },
  'setup.counter': {
    en: 'Selected: {real} real (need 1) · {decoy} decoys (need 2) · {empty} empty (need 2) — {unused} unused',
    pt: 'Selecionados: {real} real (precisas 1) · {decoy} enganos (precisas 2) · {empty} vazios (precisas 2) — {unused} por usar',
  },
  'setup.submit_assignment': { en: 'Submit assignment', pt: 'Submeter escolha' },
  'setup.role_none': { en: 'Clear', pt: 'Limpar' },
  'setup.surroundings_title': {
    en: 'Real-flag surroundings photo',
    pt: 'Foto dos arredores da bandeira real',
  },
  'setup.surroundings_hint': {
    en: 'Take one photo within 30 m of the real flag without showing the marker. It stays private unless the other team buys Surroundings intel.',
    pt: 'Tira uma foto a menos de 30 m da bandeira real sem mostrar o marcador. Fica privada, salvo se a outra equipa comprar a intel Arredores.',
  },
  'setup.surroundings_add': { en: '📷 Add surroundings photo', pt: '📷 Adicionar foto dos arredores' },
  'setup.surroundings_ready': { en: '✓ Surroundings photo ready', pt: '✓ Foto dos arredores pronta' },
  'setup.surroundings_required': {
    en: 'Add the surroundings photo before submitting.',
    pt: 'Adiciona a foto dos arredores antes de submeter.',
  },

  // ---------- live: header + tabs ----------
  'live.tab_map': { en: 'Map', pt: 'Mapa' },
  'live.tab_actions': { en: 'Actions', pt: 'Ações' },
  'live.tab_status': { en: 'Status', pt: 'Estado' },
  'live.enable_gps': { en: 'Enable GPS', pt: 'Ativar GPS' },
  'live.disable_gps': { en: 'Disable GPS', pt: 'Desativar GPS' },
  'live.gps_on': { en: 'GPS: ON', pt: 'GPS: LIGADO' },
  'live.gps_off': { en: 'GPS: OFF', pt: 'GPS: DESLIGADO' },
  'live.loading_live': { en: 'Loading live state…', pt: 'A carregar estado do jogo…' },

  // ---------- live settings ----------
  'settings.open': { en: 'Open settings', pt: 'Abrir definições' },
  'settings.title': { en: 'Settings', pt: 'Definições' },
  'settings.preferences': { en: 'Preferences', pt: 'Preferências' },
  'settings.map': { en: 'Map', pt: 'Mapa' },
  'settings.language': { en: 'Language', pt: 'Idioma' },
  'settings.sound': { en: 'Sound', pt: 'Som' },
  'settings.notifications': { en: 'Notifications', pt: 'Notificações' },
  'settings.notifications_on': { en: 'Lock-screen notifications are on', pt: 'Notificações no ecrã bloqueado ativas' },
  'settings.notifications_unavailable': { en: 'Not available on this device', pt: 'Não disponível neste dispositivo' },
  'settings.gps': { en: 'Location', pt: 'Localização' },
  'settings.gps_accuracy': { en: 'Accuracy ±{m} m', pt: 'Precisão ±{m} m' },
  'settings.gps_error': { en: 'GPS error: {error}', pt: 'Erro de GPS: {error}' },
  'settings.gps_acquiring': { en: 'Acquiring position…', pt: 'A obter posição…' },
  'settings.intel_filter': { en: 'Intel Filter', pt: 'Filtro de Intel' },
  'settings.intel_filter_hint': { en: 'Dim locations ruled out by your clues', pt: 'Escurece os locais excluídos pelas tuas pistas' },
  'settings.intel_filter_unavailable': { en: 'Buy map-based intel to reveal ruled-out areas', pt: 'Compra intel de mapa para revelar áreas excluídas' },

  // ---------- map controls ----------
  'map.fit_vila_real': { en: 'Fit Vila Real', pt: 'Centrar Vila Real' },
  'map.recenter_on_me': { en: 'Recenter on me', pt: 'Centrar em mim' },
  'map.intel_filter_off': { en: 'Intel filter OFF', pt: 'Filtro de intel DESL.' },
  'map.intel_filter_on': { en: 'Intel filter ON ({n})', pt: 'Filtro de intel LIG. ({n})' },
  'map.legend_title': { en: 'Legend', pt: 'Legenda' },
  'map.legend_your_team': { en: 'Your team', pt: 'A tua equipa' },
  'map.legend_enemy_team': { en: 'Enemy team', pt: 'Equipa adversária' },
  'map.legend_neutral': { en: 'Neutral', pt: 'Neutro' },
  'map.legend_you': { en: 'You', pt: 'Tu' },
  'map.walking_directions': { en: 'Walking directions', pt: 'Direções a pé' },
  'map.your_candidate': { en: 'your candidate', pt: 'tua candidata' },
  'map.enemy_candidate': { en: 'enemy candidate', pt: 'candidata adversária' },
  'map.your_home': { en: 'your home base', pt: 'tua base' },
  'map.enemy_home': { en: 'enemy home base', pt: 'base adversária' },
  'map.neutral_landmark': { en: 'Neutral landmark', pt: 'Marco neutro' },
  'map.unknown_attempt': { en: 'Unknown — attempt to discover', pt: 'Desconhecido — tenta descobrir' },
  'map.ruled_out': { en: 'Ruled out by intel', pt: 'Excluído por intel' },
  'map.confirmed': { en: 'Confirmed: {kind}', pt: 'Confirmado: {kind}' },

  // ---------- tag + respawn ----------
  'tag.button_enabled': { en: 'TAG ({n} within 5 m)', pt: 'APANHAR ({n} a menos de 5 m)' },
  'tag.button_disabled': { en: 'TAG', pt: 'APANHAR' },
  'tag.reason_no_gps': { en: 'Enable GPS to tag', pt: 'Ativa o GPS para apanhar' },
  'tag.reason_respawning': { en: 'You are respawning', pt: 'Estás a reaparecer' },
  'tag.reason_out_of_zone': { en: 'Not in defense zone', pt: 'Fora da zona de defesa' },
  'tag.reason_no_enemies': { en: 'No enemies within 5 m', pt: 'Sem adversários a menos de 5 m' },
  'tag.reason_camping': { en: 'Camping locked', pt: 'Bloqueado por camping' },
  'tag.confirm': { en: 'Tag {n} player(s)?', pt: 'Apanhar {n} jogador(es)?' },
  'tag.success': { en: 'Tagged {n} player(s)', pt: 'Apanhaste {n} jogador(es)' },
  'respawn.title': { en: 'You were tagged.', pt: 'Foste apanhado.' },
  'respawn.body': {
    en: 'Walk to a NEUTRAL landmark (Sé, Pelourinho, Teatro, Rodoviária) and tap below when you arrive.',
    pt: 'Caminha até um marco NEUTRO (Sé, Pelourinho, Teatro, Rodoviária) e toca abaixo quando lá chegares.',
  },
  'respawn.button': { en: "I'm at a neutral landmark", pt: 'Estou num marco neutro' },
  'respawn.need_gps': { en: 'Enable GPS to confirm position', pt: 'Ativa o GPS para confirmar a posição' },
  'respawn.too_far': { en: "You're {m} m from the nearest neutral — keep walking.", pt: 'Estás a {m} m do marco neutro mais próximo — continua a andar.' },

  // ---------- flag attempt / carrier / found ----------
  'flag_attempt.button_enabled': { en: 'ATTEMPT FLAG · {name} ({m} m)', pt: 'TENTAR BANDEIRA · {name} ({m} m)' },
  'flag_attempt.button_disabled': { en: 'ATTEMPT FLAG', pt: 'TENTAR BANDEIRA' },
  'flag_attempt.reason_no_gps': { en: 'Enable GPS to attempt', pt: 'Ativa o GPS para tentar' },
  'flag_attempt.reason_respawning': { en: 'You are respawning', pt: 'Estás a reaparecer' },
  'flag_attempt.reason_not_live': { en: 'Available during live game', pt: 'Disponível durante o jogo' },
  'flag_attempt.reason_out_of_range': { en: 'No enemy landmark within 20 m', pt: 'Sem marco adversário a menos de 20 m' },
  'flag_attempt.reason_discovered': { en: 'Already discovered', pt: 'Já descoberto' },
  'flag_attempt.confirm': { en: 'Attempt flag at {name}?', pt: 'Tentar bandeira em {name}?' },
  'flag_attempt.toast_real': { en: 'REAL FLAG — RUN HOME!', pt: 'BANDEIRA REAL — CORRE PARA CASA!' },
  'flag_attempt.toast_decoy': { en: 'Decoy! All intel lost.', pt: 'Engano! Perdeste toda a intel.' },
  'flag_attempt.toast_empty': { en: 'Empty. Nothing here.', pt: 'Vazio. Nada aqui.' },
  'flag_carrier.title': { en: 'YOU HAVE THE FLAG', pt: 'TENS A BANDEIRA' },
  'flag_carrier.run_to': { en: 'Run to {name}', pt: 'Corre para {name}' },
  'flag_carrier.distance': { en: '~{m} m away', pt: 'a ~{m} m' },
  'flag_carrier.submitting': { en: 'Submitting…', pt: 'A submeter…' },
  'flag_found.team_msg': { en: 'Your team found the flag! {name} is running to home base.', pt: 'A tua equipa encontrou a bandeira! {name} corre para a base.' },
  'flag_found.enemy_msg': { en: 'Enemy found your flag! {name} is running to {home}. Intercept them!', pt: 'O adversário encontrou a vossa bandeira! {name} corre para {home}. Intercetem-no!' },

  // ---------- game over ----------
  'gameover.tag': { en: 'Game over', pt: 'Fim de jogo' },
  'gameover.wins': { en: '{team} wins!', pt: '{team} ganhou!' },
  'gameover.tie': { en: 'Tie game', pt: 'Empate' },
  'gameover.reason_flag_returned': { en: 'Flag returned to home base', pt: 'Bandeira entregue na base' },
  'gameover.reason_timeout_points': { en: 'Won on points after 3-hour timeout', pt: 'Vencedor por pontos após 3 horas' },
  'gameover.reason_timeout_tiebreaker': { en: 'Won on tiebreaker after 3-hour timeout', pt: 'Vencedor por desempate após 3 horas' },
  'gameover.reason_timeout_tied': { en: 'Tied — all tiebreakers exhausted', pt: 'Empate — todos os desempates esgotados' },
  'gameover.reason_timeout_coin_flip': {
    en: 'Won by coin flip after all tiebreakers were tied',
    pt: 'Vencedor por lançamento de moeda após todos os desempates',
  },
  'gameover.you_won': { en: 'Congratulations.', pt: 'Parabéns.' },
  'gameover.you_lost': { en: 'Better luck next round.', pt: 'Para a próxima.' },
  'gameover.row_real_flag': { en: 'Real flag photographed', pt: 'Bandeira fotografada' },
  'gameover.row_challenges': { en: 'Challenges completed', pt: 'Desafios completados' },
  'gameover.row_tags': { en: 'Tags made', pt: 'Apanhas' },
  'gameover.row_curses': { en: 'Curses cast (stat)', pt: 'Maldições lançadas (estatística)' },
  'gameover.row_coins': { en: 'Coins (tiebreaker)', pt: 'Moedas (desempate)' },
  'gameover.row_total': { en: 'Total', pt: 'Total' },
  'gameover.winner_badge': { en: 'winner', pt: 'vencedor' },
  'gameover.recent_events': { en: 'Last 20 events', pt: 'Últimos 20 eventos' },
  'gameover.view_timeline': { en: 'View full timeline', pt: 'Ver cronologia completa' },
  'gameover.no_events': { en: 'No events recorded.', pt: 'Sem eventos registados.' },

  // ---------- actions tab: intel ----------
  'intel.panel_title': { en: 'Buy Intel', pt: 'Comprar Intel' },
  'intel.cap': { en: '{used}/{cap} cards used', pt: '{used}/{cap} cartas usadas' },
  'intel.buy': { en: 'Buy', pt: 'Comprar' },
  'intel.buying': { en: 'Buying…', pt: 'A comprar…' },
  'intel.confirm': { en: 'Buy {name} for {cost} coins?', pt: 'Comprar {name} por {cost} moedas?' },
  'intel.reason_not_live': { en: 'Available during live game', pt: 'Disponível durante o jogo' },
  'intel.reason_already_purchased': { en: 'Already purchased', pt: 'Já comprado' },
  'intel.reason_cap_reached': { en: 'Intel cap reached (4)', pt: 'Limite de intel atingido (4)' },
  'intel.reason_insufficient': { en: 'Need {n} more coins', pt: 'Faltam {n} moedas' },
  'intel.reason_needs_gps': { en: 'Enable GPS to buy', pt: 'Ativa o GPS para comprar' },
  'intel.acquired': { en: 'Intel acquired — see Status tab', pt: 'Intel adquirida — vê o separador Estado' },
  'intel.panel_hint': {
    en: 'Each card reveals one clue about the enemy real flag. The 4-card cap applies to the whole game.',
    pt: 'Cada carta revela uma pista sobre a bandeira verdadeira adversária. O limite de 4 cartas aplica-se ao jogo inteiro.',
  },
  'intel.owned': { en: 'Owned', pt: 'Comprada' },

  // ---------- actions tab: curses ----------
  'curse.panel_title': { en: 'Cast a Curse', pt: 'Lançar Maldição' },
  'curse.panel_hint': {
    en: 'Cost: 50 coins per die. Higher rolls = stronger curse.',
    pt: 'Custo: 50 moedas por dado. Lançamentos mais altos = maldição mais forte.',
  },
  'curse.dice': { en: '{n} {dice_word}', pt: '{n} {dice_word}' },
  'curse.die_singular': { en: 'die', pt: 'dado' },
  'curse.die_plural': { en: 'dice', pt: 'dados' },
  'curse.cast_button': { en: 'Cast Curse · {cost} coins', pt: 'Lançar maldição · {cost} moedas' },
  'curse.casting': { en: 'Casting…', pt: 'A lançar…' },
  'curse.confirm': { en: 'Cast a curse using {dice}? Cost: {cost} coins.', pt: 'Lançar maldição com {dice}? Custo: {cost} moedas.' },
  'curse.reason_not_live': { en: 'Available during live game', pt: 'Disponível durante o jogo' },
  'curse.reason_insufficient': { en: 'Need {n} more coins', pt: 'Faltam {n} moedas' },
  'curse.rolled': { en: 'Rolled: {rolls} = {total} ({tier})', pt: 'Lançamento: {rolls} = {total} ({tier})' },
  'curse.tier_minor': { en: 'minor', pt: 'menor' },
  'curse.tier_medium': { en: 'medium', pt: 'média' },
  'curse.tier_major': { en: 'major', pt: 'maior' },
  'curse.dismiss': { en: 'Dismiss', pt: 'Dispensar' },
  'curse.banner_title': { en: 'Curses on us', pt: 'Maldições em nós' },
  'curse.expired_hint': { en: '(expired — refreshing…)', pt: '(expirada — a atualizar…)' },
  'curse.rolling': { en: 'Rolling…', pt: 'A lançar…' },
  'curse.duration': { en: 'Duration: {n} min', pt: 'Duração: {n} min' },
  'curse.ledger_coin_drain': { en: 'Enemy team lost {amount} coins (now {balance}).', pt: 'A equipa adversária perdeu {amount} moedas (tem agora {balance}).' },
  'curse.ledger_intel_loss': { en: 'Enemy team lost an intel card ({name}).', pt: 'A equipa adversária perdeu uma carta de intel ({name}).' },
  'curse.ledger_no_intel': { en: 'Enemy team had no intel cards to lose.', pt: 'A equipa adversária não tinha cartas de intel para perder.' },
  'curse.ledger_full_stop': { en: 'Enemy team is locked out of app actions for the duration.', pt: 'As ações da app da equipa adversária ficam bloqueadas durante a maldição.' },
  'curse.ledger_check_in': { en: 'Affected players acknowledge in-app prompts every 2 minutes; misses are logged.', pt: 'Os jogadores afetados confirmam avisos da app a cada 2 minutos; as falhas ficam registadas.' },

  // ---------- actions tab: challenges ----------
  'challenge.panel_title': { en: 'Challenges', pt: 'Desafios' },
  'challenge.active_count': { en: '{n} active', pt: '{n} ativos' },
  'challenge.panel_hint': {
    en: 'Earn coins by completing location-based tasks. Photo tasks are verified by the other team.',
    pt: 'Ganha moedas ao completar tarefas em locais específicos. A outra equipa verifica as tarefas com foto.',
  },
  'challenge.reward': { en: '+{n} coins', pt: '+{n} moedas' },
  'challenge.available_anywhere': { en: 'Available anywhere', pt: 'Disponível em qualquer lugar' },
  'challenge.distance': { en: '~{m} m away', pt: 'a ~{m} m' },
  'challenge.out_of_range': { en: 'Out of range', pt: 'Fora de alcance' },
  'challenge.submit': { en: 'Submit', pt: 'Submeter' },
  'challenge.submitting': { en: 'Submitting…', pt: 'A submeter…' },
  'challenge.reason_not_live': { en: 'Available during live game', pt: 'Disponível durante o jogo' },
  'challenge.reason_respawning': { en: 'You are respawning', pt: 'Estás a reaparecer' },
  'challenge.reason_no_gps': { en: 'Enable GPS', pt: 'Ativa o GPS' },
  'challenge.reason_too_far': { en: 'Get closer (currently {m})', pt: 'Aproxima-te (atualmente a {m})' },
  'challenge.toast_reward': { en: '+{n} coins', pt: '+{n} moedas' },
  'challenge.toast_first_blood': { en: ' (+30 first blood!)', pt: ' (+30 primeiro sangue!)' },
  'challenge.history_title': { en: 'Challenge history', pt: 'Histórico de desafios' },
  'challenge.history_empty': { en: 'No challenges completed yet.', pt: 'Nenhum desafio completado ainda.' },
  'challenge.loading': { en: 'Loading challenges…', pt: 'A carregar desafios…' },
  'challenge.none_active': { en: 'No active challenges right now.', pt: 'Não há desafios ativos neste momento.' },
  'challenge.submission_required': { en: 'A submission is required for this challenge.', pt: 'Este desafio exige uma resposta.' },
  'challenge.answer_windows': { en: 'How many windows? (number)', pt: 'Quantas janelas? (número)' },
  'challenge.answer_rivers': { en: 'Name the two rivers', pt: 'Indica os dois rios' },
  'challenge.answer_latin': { en: 'Latin name from the placard', pt: 'Nome em latim indicado na placa' },
  'challenge.answer_quote': { en: 'Paste the quote from the local', pt: 'Copia a frase do local' },
  'challenge.answer': { en: 'Challenge answer', pt: 'Resposta ao desafio' },
  'challenge.gps_off': { en: 'GPS off', pt: 'GPS desligado' },
  'challenge.away': { en: '{distance} away', pt: 'a {distance}' },
  'challenge.photo_verified': { en: '📷 verified', pt: '📷 verificado' },

  // ---------- status tab ----------
  'status.coins': { en: 'Team coins', pt: 'Moedas da equipa' },
  'status.intel_title': { en: 'Intel', pt: 'Intel' },
  'status.intel_empty': { en: 'No intel cards yet.', pt: 'Sem cartas de intel.' },
  'status.curses_on_us': { en: 'Curses on us', pt: 'Maldições em nós' },
  'status.curses_empty': { en: 'No active curses.', pt: 'Sem maldições ativas.' },
  'status.curse_history': { en: 'Curse history', pt: 'Histórico de maldições' },
  'status.curse_history_empty': { en: 'No curse activity yet.', pt: 'Sem atividade de maldições.' },
  'status.timeline': { en: 'Event timeline', pt: 'Cronologia de eventos' },
  'status.timeline_empty': { en: 'No events yet.', pt: 'Sem eventos ainda.' },
  'status.harden_button': { en: 'Harden flag (150 coins)', pt: 'Reforçar bandeira (150 moedas)' },
  'status.harden_action': { en: 'Harden flag · {cost} coins', pt: 'Reforçar bandeira · {cost} moedas' },
  'status.harden_confirm': {
    en: 'Spend 150 coins to harden your real flag? You can only do this once.',
    pt: 'Gastar 150 moedas para reforçar a bandeira real? Só podes fazer isto uma vez.',
  },
  'status.hardening': { en: 'Hardening…', pt: 'A reforçar…' },
  'status.team_balance': { en: 'Team {side} balance', pt: 'Saldo da Equipa {side}' },
  'status.none': { en: 'None.', pt: 'Nenhuma.' },
  'status.timeline_short': { en: 'Timeline', pt: 'Cronologia' },
  'status.event_by': { en: 'by {actor}', pt: 'por {actor}' },
  'status.someone': { en: 'someone', pt: 'alguém' },
  'status.system': { en: 'system', pt: 'sistema' },
  'status.harden_title': { en: 'Harden your flag', pt: 'Reforça a tua bandeira' },
  'status.harden_hint': {
    en: 'Spend {cost} coins to upgrade your real flag challenge to a harder variant. Once per game.',
    pt: 'Gasta {cost} moedas para tornar o desafio da bandeira verdadeira mais difícil. Uma vez por jogo.',
  },
  'status.hardened': { en: 'Already hardened', pt: 'Já reforçada' },
  'status.harden_success': { en: 'Flag challenge hardened.', pt: 'Desafio da bandeira reforçado.' },
  'status.harden_no_flag': { en: 'No real flag assigned yet', pt: 'Ainda não há bandeira verdadeira atribuída' },
  'status.harden_unavailable': { en: 'Not available right now', pt: 'Não disponível neste momento' },
  'status.harden_cost': { en: 'Costs {cost} coins — you have {coins}', pt: 'Custa {cost} moedas — tens {coins}' },
  'status.curse_received': { en: 'Curse received: {name}', pt: 'Maldição recebida: {name}' },
  'status.curse_expired': { en: 'Curse expired: {name}', pt: 'Maldição terminada: {name}' },
  'status.coin_drain': { en: 'Coin drain: -{n} coins', pt: 'Dreno de moedas: -{n} moedas' },
  'status.coin_drain_applied': { en: 'Coin drain applied', pt: 'Dreno de moedas aplicado' },
  'status.intel_lost': { en: 'Intel lost: {name}', pt: 'Intel perdida: {name}' },
  'status.intel_lost_generic': { en: 'Intel lost', pt: 'Intel perdida' },
  'status.proof_submitted': { en: 'Proof submitted: {name}{index}', pt: 'Prova submetida: {name}{index}' },
  'status.first_blood': { en: 'first blood', pt: 'primeiro sangue' },
  'status.intel_cards_title': { en: 'My intel cards', pt: 'As minhas cartas de intel' },
  'status.intel_cards_empty': { en: 'No intel purchased yet. Buy intel from the Actions tab.', pt: 'Ainda não compraste intel. Compra-a no separador Ações.' },
  'status.real_flag_north_south': { en: 'Real flag is to the {direction} of the city centre.', pt: 'A bandeira verdadeira fica a {direction} do centro da cidade.' },
  'status.real_flag_east_west': { en: 'Real flag is to the {direction} of the enemy home base.', pt: 'A bandeira verdadeira fica a {direction} da base adversária.' },
  'status.not_real': { en: '{name} is NOT the real flag.', pt: '{name} NÃO tem a bandeira verdadeira.' },
  'status.not_real_two': { en: '{first} and {second} are NOT the real flag.', pt: '{first} e {second} NÃO têm a bandeira verdadeira.' },
  'status.is_decoy': { en: '{name} is a decoy.', pt: '{name} é um engano.' },
  'status.hot_cold_bought': { en: 'Real flag distance when bought: {bucket}', pt: 'Distância à bandeira quando compraste: {bucket}' },
  'status.enable_gps_live': { en: ' · enable GPS for a live reading', pt: ' · ativa o GPS para uma leitura em direto' },
  'status.surroundings': { en: 'Surroundings near the real flag:', pt: 'Arredores da bandeira verdadeira:' },
  'status.surroundings_alt': { en: 'Surroundings near the enemy real flag', pt: 'Arredores da bandeira verdadeira adversária' },
  'status.bearing': { en: 'Bearing from city centre: {bearing}', pt: 'Direção a partir do centro da cidade: {bearing}' },
  'status.unknown_intel': { en: '(unknown intel)', pt: '(intel desconhecida)' },

  // ---------- curse enforcement (banner + prompts) ----------
  // (reuses existing curse.banner_title / curse.expired_hint above)
  'curse.no_timer': { en: 'no timer', pt: 'sem cronómetro' },
  'curse.actions_locked': {
    en: 'Actions locked — Full Stop in effect',
    pt: 'Ações bloqueadas — Paragem Total em vigor',
  },
  'curse.pilgrimage_locked': {
    en: 'Actions locked — complete the Pilgrimage first',
    pt: 'Ações bloqueadas — completa primeiro a Peregrinação',
  },
  'curse.readout_nearest_pair': {
    en: 'Nearest teammates {m} m apart',
    pt: 'Colegas mais próximos a {m} m',
  },
  'curse.readout_pilgrimage': {
    en: 'Pilgrimage: {name} · {m} m away',
    pt: 'Peregrinação: {name} · a {m} m',
  },
  'curse.prompt.mute': {
    en: 'Still muted? Communicate only through in-app chat.',
    pt: 'Ainda em silêncio? Comunica apenas pelo chat da app.',
  },
  'curse.prompt.backwards': {
    en: 'Keep walking backwards; a teammate may guide you.',
    pt: 'Continua a andar de costas; um colega pode guiar-te.',
  },
  'curse.prompt.detour': {
    en: 'Detour active — stay off {name}.',
    pt: 'Desvio ativo — evita {name}.',
  },
  'curse.detour_unknown_street': {
    en: 'the banned street',
    pt: 'a rua proibida',
  },
  'curse.readout_detour': {
    en: '{name}: {m} m away',
    pt: '{name}: a {m} m',
  },
  'curse.checkin_prompt': { en: 'Check in now', pt: 'Faz check-in já' },
  'curse.checkin_ack': { en: '✓ Checked in', pt: '✓ Check-in feito' },
  // Live readouts for [A] movement curses — informational, no auto-penalty.
  'curse.readout_speed': { en: 'Speed {kmh} km/h', pt: 'Velocidade {kmh} km/h' },
  'curse.readout_drift': { en: 'Drift {m} m from start', pt: 'Desvio {m} m do início' },
  'curse.readout_spread': { en: 'Team spread {m} m', pt: 'Dispersão da equipa {m} m' },
  'curse.readout_quarantine': { en: 'Quarantine spread {m} m', pt: 'Dispersão na quarentena {m} m' },
  // Timed prompt labels for [B] photo curses.
  'curse.prompt_window': { en: '{label} · {s}s', pt: '{label} · {s}s' },
  'curse.prompt.single-file': {
    en: 'Group photo from the front',
    pt: 'Foto de grupo pela frente',
  },
  'curse.prompt.photo-tax': { en: 'Selfie at any sign', pt: 'Selfie junto a uma placa' },
  'curse.prompt.outfit-swap': {
    en: 'Before/after outfit photo',
    pt: 'Foto antes/depois da troca de roupa',
  },
  'curse.prompt.pose-patrol': {
    en: 'Strike the pose, then photograph',
    pt: 'Faz a pose e fotografa',
  },
  'curse.proof_add': { en: '📷 Add proof photo', pt: '📷 Adicionar foto de prova' },
  'curse.proof_ready': { en: '✓ Photo ready', pt: '✓ Foto pronta' },
  'curse.proof_submit': { en: 'Submit proof', pt: 'Submeter prova' },
  'curse.proof_submitting': { en: 'Submitting…', pt: 'A submeter…' },
  'curse.proof_required': {
    en: 'A real photo is required before this window closes.',
    pt: 'É necessária uma foto real antes de esta janela fechar.',
  },
  'curse.proof_submitted': {
    en: '✓ Proof photo submitted',
    pt: '✓ Foto de prova submetida',
  },
  'curse.proof_error': {
    en: 'Could not submit proof ({error}).',
    pt: 'Não foi possível submeter a prova ({error}).',
  },

  // ---------- flag attempt window / lockout (P2-1 / P2-3 / P2-4) ----------
  'attempt.locked_window': {
    en: 'Attempts unlock in {time}',
    pt: 'Capturas abrem em {time}',
  },
  'attempt.window_header': {
    en: 'Flag attempts unlock in {time}',
    pt: 'Capturas de bandeira abrem em {time}',
  },
  'attempt.err_attempts_locked': {
    en: 'Flag attempts are locked for the first 30 minutes.',
    pt: 'As capturas estão bloqueadas nos primeiros 30 minutos.',
  },
  'attempt.err_landmark_locked_out': {
    en: 'This landmark is locked for 15 min after a failed attempt.',
    pt: 'Este local fica bloqueado 15 min após uma tentativa falhada.',
  },
  'attempt.err_out_of_geofence': {
    en: 'Get closer to the landmark and try again.',
    pt: 'Aproxima-te do local e tenta de novo.',
  },
  'attempt.err_photo_required': {
    en: 'Add a photo first.',
    pt: 'Adiciona primeiro uma foto.',
  },
  'attempt.err_photo_upload_failed': {
    en: 'Photo upload failed — try again.',
    pt: 'Falha ao enviar a foto — tenta de novo.',
  },

  // ---------- discovery notifications / toasts (P2-5) ----------
  'toast.defender_attempt_start': {
    en: 'Enemy is attempting your landmark — {name}',
    pt: 'Inimigo a atacar o teu local — {name}',
  },
  'toast.teammate_attempt_start': {
    en: '{player} is attempting {name}',
    pt: '{player} está a atacar {name}',
  },
  'toast.defender_discovered': {
    en: 'Your flag was discovered at {name}!',
    pt: 'A tua bandeira foi descoberta em {name}!',
  },
  'toast.defender_failed': {
    en: 'Flag still hidden — attack failed at {name}',
    pt: 'Bandeira ainda escondida — ataque falhou em {name}',
  },
  'toast.teammate_found_real': {
    en: 'Flag found at {name} — it was the real flag!',
    pt: 'Bandeira encontrada em {name} — era a verdadeira!',
  },
  'toast.teammate_attempt_failed': {
    en: 'Flag attempt at {name} failed',
    pt: 'Tentativa em {name} falhou',
  },
  'toast.enemy_near': {
    en: 'Enemy near {name}',
    pt: 'Inimigo perto de {name}',
  },
  'toast.placed_curse_hit': {
    en: 'You walked into a trap — a curse hit your team!',
    pt: 'Caíste numa armadilha — uma maldição atingiu a tua equipa!',
  },
  'push.enable': {
    en: 'Enable lock-screen notifications',
    pt: 'Ativar notificações no ecrã bloqueado',
  },
  'push.enabling': {
    en: 'Enabling notifications…',
    pt: 'A ativar notificações…',
  },
  'push.denied': {
    en: 'Notifications are blocked in browser settings.',
    pt: 'As notificações estão bloqueadas nas definições do navegador.',
  },
  'push.error': {
    en: 'Notifications could not be enabled. Try again.',
    pt: 'Não foi possível ativar as notificações. Tenta novamente.',
  },

  // Big-moment popups (animated). Capture / tag / trap. Player gametags are
  // woven in so 2+ player teams know who did what.
  'moment.capture.title': { en: 'FLAG CAPTURED!', pt: 'BANDEIRA CAPTURADA!' },
  'moment.capture.sub': {
    en: '{player} found the real flag at {name} — run to home base!',
    pt: '{player} encontrou a bandeira real em {name} — corram para a base!',
  },
  'moment.discovered.title': { en: 'FLAG DISCOVERED!', pt: 'BANDEIRA DESCOBERTA!' },
  'moment.discovered.sub': {
    en: '{player} found your flag at {name} — intercept them!',
    pt: '{player} encontrou a tua bandeira em {name} — intercetem!',
  },
  'moment.tag_made.title': { en: 'RAIDER TAGGED!', pt: 'RAIDER APANHADO!' },
  'moment.tag_made.sub': {
    en: '{tagger} tagged {raider} — they lose intel and must respawn',
    pt: '{tagger} apanhou {raider} — perde intel e tem de renascer',
  },
  'moment.tagged.title': { en: 'TAGGED!', pt: 'APANHADO!' },
  'moment.tagged.sub': {
    en: '{raider} got tagged by {tagger} — walk to a neutral landmark',
    pt: '{raider} foi apanhado por {tagger} — vai a um local neutro',
  },
  'moment.trap.title': { en: 'TRAP SPRUNG!', pt: 'ARMADILHA!' },
  'moment.trap.sub': {
    en: '{player} walked into a hidden curse!',
    pt: '{player} caiu numa maldição escondida!',
  },

  // Sound mute toggle (live header).
  'sound.mute': { en: 'Mute sounds', pt: 'Silenciar sons' },
  'sound.unmute': { en: 'Unmute sounds', pt: 'Ativar sons' },

  // Walking-only gentle nudge.
  'walk.nudge': {
    en: '🚶 Walking only — please slow down!',
    pt: '🚶 Só a pé — abranda, por favor!',
  },
  'walk.speed': { en: '~{speed} km/h', pt: '~{speed} km/h' },

  // End-game chase HUD.
  'chase.carrier': {
    en: '🏁 {home} m to home · nearest hunter {hunter} m',
    pt: '🏁 {home} m até à base · perseguidor mais perto {hunter} m',
  },
  'chase.defender': {
    en: '⚠️ Carrier {home} m from winning — cut them off!',
    pt: '⚠️ Portador a {home} m de ganhar — intercetem-no!',
  },

  // Time bonus.
  'timebonus.next': {
    en: '⏱️ +{amount} coins in {time}',
    pt: '⏱️ +{amount} moedas em {time}',
  },

  // Post-game recap.
  'recap.title': { en: 'Match recap', pt: 'Resumo do jogo' },
  'recap.your_score': { en: 'Your score: {score}', pt: 'A tua pontuação: {score}' },
  'recap.mvp': { en: 'MVP', pt: 'Melhor jogador' },
  'recap.mvp_tags': { en: '{count} tags made', pt: '{count} apanhados' },
  'recap.no_mvp': { en: 'No tags this match', pt: 'Nenhum apanhado neste jogo' },
  'recap.you': { en: 'you', pt: 'tu' },
  'recap.first_blood': { en: 'First blood', pt: 'Primeiro sangue' },
  'recap.no_first_blood': {
    en: 'No challenges completed',
    pt: 'Nenhum desafio concluído',
  },
  'recap.stat_tags': { en: 'Tags', pt: 'Apanhados' },
  'recap.stat_challenges': { en: 'Challenges', pt: 'Desafios' },
  'recap.stat_curses': { en: 'Curses', pt: 'Maldições' },
  'recap.stat_captures': { en: 'Captures', pt: 'Capturas' },
  'recap.highlights': { en: 'Highlights', pt: 'Destaques' },
  'recap.no_highlights': {
    en: 'No highlights recorded',
    pt: 'Sem destaques registados',
  },

  // ---------- placed curses (P2-2) ----------
  'placed.title': { en: 'Place a curse', pt: 'Colocar maldição' },
  'placed.hint': {
    en: 'Arm one of your own landmarks. It triggers when an enemy enters its zone — hidden until then.',
    pt: 'Arma um dos teus locais. Dispara quando um inimigo entra na zona — invisível até lá.',
  },
  'placed.select_landmark': { en: 'Choose your landmark', pt: 'Escolhe o teu local' },
  'placed.place_button': { en: 'Place · {cost}', pt: 'Colocar · {cost}' },
  'placed.placing': { en: 'Placing…', pt: 'A colocar…' },
  'placed.armed_label': {
    en: 'Armed on {landmark}',
    pt: 'Armada em {landmark}',
  },
  'placed.armed_header': { en: 'Your armed placements', pt: 'As tuas armadilhas' },
  'placed.none_available': {
    en: 'All your landmarks are already armed.',
    pt: 'Todos os teus locais já estão armados.',
  },
  'placed.need_coins': { en: 'Need {n} more coins', pt: 'Faltam {n} moedas' },

  // ---------- confirm-spend modal (G21) ----------
  'spend.title': { en: 'Confirm purchase', pt: 'Confirmar compra' },
  'spend.item': { en: 'Item', pt: 'Item' },
  'spend.cost': { en: 'Cost', pt: 'Custo' },
  'spend.balance_now': { en: 'Balance now', pt: 'Saldo atual' },
  'spend.balance_after': { en: 'Balance after', pt: 'Saldo depois' },
  'spend.confirm_button': { en: 'Confirm & spend', pt: 'Confirmar e gastar' },
  'spend.insufficient': { en: 'Not enough coins', pt: 'Moedas insuficientes' },

  // ---------- in-game chat (G22) ----------
  'chat.tab': { en: 'Chat', pt: 'Chat' },
  'chat.title': { en: 'Chat', pt: 'Chat' },
  'chat.channel_global': { en: 'All players', pt: 'Todos' },
  'chat.channel_team': { en: 'My team', pt: 'Minha equipa' },
  'chat.placeholder': { en: 'Message…', pt: 'Mensagem…' },
  'chat.send': { en: 'Send', pt: 'Enviar' },
  'chat.empty': { en: 'No messages yet. Say hi!', pt: 'Ainda sem mensagens. Diz olá!' },
  'chat.ephemeral_note': {
    en: 'Live only — messages are not saved.',
    pt: 'Só ao vivo — as mensagens não são guardadas.',
  },
  'chat.you': { en: 'You', pt: 'Tu' },
  'chat.connecting': { en: 'Connecting…', pt: 'A ligar…' },
  'chat.unread': { en: '{n} new', pt: '{n} novas' },

  // ---------- two-team weather pause ----------
  'weather.title': { en: 'Weather pause', pt: 'Pausa meteorológica' },
  'weather.two_team_hint': {
    en: 'Either team can request it; the other team must confirm within 5 minutes.',
    pt: 'Qualquer equipa pode pedir; a outra tem de confirmar em 5 minutos.',
  },
  'weather.paused_title': { en: 'Weather pause — Paused', pt: 'Pausa meteorológica — Em pausa' },
  'weather.paused_body': {
    en: 'Gameplay, the match clock, and curse timers are frozen.',
    pt: 'As ações, o relógio do jogo e os temporizadores das maldições estão parados.',
  },
  'weather.request_pause': { en: 'Request weather pause', pt: 'Pedir pausa' },
  'weather.confirm_pause': { en: 'Confirm weather pause', pt: 'Confirmar pausa' },
  'weather.pause_requested': { en: 'Pause requested', pt: 'Pausa pedida' },
  'weather.request_resume': { en: 'Request resume', pt: 'Pedir retoma' },
  'weather.confirm_resume': { en: 'Confirm resume', pt: 'Confirmar retoma' },
  'weather.resume_requested': { en: 'Resume requested', pt: 'Retoma pedida' },
  'weather.waiting_other': {
    en: 'Waiting for the other team to confirm.',
    pt: 'À espera que a outra equipa confirme.',
  },
  'weather.other_requested': {
    en: 'The other team requested this.',
    pt: 'A outra equipa fez este pedido.',
  },
  'weather.expires_in': { en: 'Expires in {time}.', pt: 'Expira em {time}.' },
  'weather.saving': { en: 'Submitting…', pt: 'A enviar…' },
  'weather.actions_locked': {
    en: 'Game paused for weather — all gameplay actions are locked.',
    pt: 'Jogo em pausa devido ao tempo — todas as ações estão bloqueadas.',
  },

  // ---------- two-stage respawn ----------
  'respawn.tagged': { en: 'You were tagged.', pt: 'Foste apanhado.' },
  'respawn.gameplay_locked': {
    en: 'Respawn required — reach and leave your assigned neutral before using game actions.',
    pt: 'Respawn obrigatório — chega ao ponto neutro atribuído e afasta-te antes de usar ações do jogo.',
  },
  'respawn.assigned_neutral': {
    en: 'the assigned neutral landmark',
    pt: 'o ponto neutro atribuído',
  },
  'respawn.target_hint': {
    en: 'Your required respawn point is {target}. Go there, then confirm your arrival.',
    pt: 'O teu ponto de respawn obrigatório é {target}. Vai até lá e confirma a chegada.',
  },
  'respawn.arrived_hint': {
    en: 'Arrival confirmed at {target}. Walk at least 45 m away, then confirm to rejoin.',
    pt: 'Chegada confirmada em {target}. Afasta-te pelo menos 45 m e confirma para voltares ao jogo.',
  },
  'respawn.checking': { en: 'Checking…', pt: 'A verificar…' },
  'respawn.reached_target': { en: "I've reached {target}", pt: 'Cheguei a {target}' },
  'respawn.left_target': { en: "I've left {target}", pt: 'Afastei-me de {target}' },
  'respawn.enable_gps': {
    en: 'Enable GPS to confirm position.',
    pt: 'Ativa o GPS para confirmar a posição.',
  },
  'respawn.wrong_target': {
    en: 'Wrong neutral — go to {target} ({distance} m away).',
    pt: 'Ponto neutro errado — vai até {target} (a {distance} m).',
  },
  'respawn.go_to_target': {
    en: 'Go to {target} ({distance} m away).',
    pt: 'Vai até {target} (a {distance} m).',
  },
  'respawn.must_leave': {
    en: 'Arrival confirmed. Walk at least {distance} m away from {target} to rejoin.',
    pt: 'Chegada confirmada. Afasta-te pelo menos {distance} m de {target} para voltares ao jogo.',
  },

  // ---------- challenge peer-verification (D14) ----------
  'challenge.photo_add': { en: '📷 Add photo', pt: '📷 Adicionar foto' },
  'challenge.photo_change': { en: '✓ Photo ready', pt: '✓ Foto pronta' },
  'challenge.photo_required_hint': {
    en: 'Needs a photo the other team will verify.',
    pt: 'Precisa de foto que a outra equipa vai verificar.',
  },
  'challenge.pending_review': {
    en: 'Waiting for the other team — auto-accepts after 120 seconds unless rejected.',
    pt: 'À espera da outra equipa — aceite automaticamente após 120 segundos se não for rejeitado.',
  },
  'challenge.rejected_resubmit': {
    en: 'Rejected — submit a new photo.',
    pt: 'Rejeitada — envia uma nova foto.',
  },
  'challenge.review_title': { en: 'Photos to review', pt: 'Fotos para verificar' },
  'challenge.review_none': {
    en: 'Nothing to review right now.',
    pt: 'Nada para verificar de momento.',
  },
  'challenge.review_line': {
    en: '{team} · {name} (+{coins})',
    pt: '{team} · {name} (+{coins})',
  },
  'challenge.view_photo': { en: 'View photo', pt: 'Ver foto' },
  'challenge.accept': { en: 'Accept', pt: 'Aceitar' },
  'challenge.reject': { en: 'Reject', pt: 'Rejeitar' },
  'challenge.reviewing': { en: 'Saving…', pt: 'A guardar…' },
  'challenge.review_toast': {
    en: 'A challenge photo needs your review',
    pt: 'Uma foto de desafio precisa da tua verificação',
  },
  'challenge.submitted_feed': {
    en: '{team} submitted {name} for review',
    pt: '{team} submeteu {name} para verificação',
  },
  'challenge.accepted_feed': {
    en: '{name} accepted (+{coins})',
    pt: '{name} aceite (+{coins})',
  },
  'challenge.rejected_feed': {
    en: '{name} rejected — resubmit',
    pt: '{name} rejeitada — reenviar',
  },

  // ---------- setup: map-first flag selection (A2/A3/A4) ----------
  'setup.intro': {
    en: 'Team {side}: meet at {home}, then choose five candidate landmarks.',
    pt: 'Equipa {side}: reúne-te em {home} e escolhe cinco locais candidatos.',
  },
  'setup.step_choose': { en: 'Step 1', pt: 'Passo 1' },
  'setup.choose_title': {
    en: 'Choose and assign landmarks',
    pt: 'Escolhe e atribui os locais',
  },
  'setup.assignment_rule': {
    en: 'Assign exactly 1 real flag, 2 decoys, and 2 empty locations.',
    pt: 'Atribui exatamente 1 bandeira verdadeira, 2 enganos e 2 locais vazios.',
  },
  'setup.tab_map': { en: 'Map', pt: 'Mapa' },
  'setup.tab_list': { en: 'List', pt: 'Lista' },
  'setup.map_hint': {
    en: 'Only your team pool is shown. Tap a numbered marker, then choose its role below.',
    pt: 'Só aparecem os locais da tua equipa. Toca num marcador numerado e escolhe a função abaixo.',
  },
  'setup.your_pool': { en: 'Your candidate pool', pt: 'Os teus locais candidatos' },
  'setup.selected_landmark': { en: 'Selected landmark', pt: 'Local selecionado' },
  'setup.select_landmark': {
    en: 'Tap a numbered marker to select a landmark.',
    pt: 'Toca num marcador numerado para selecionar um local.',
  },
  'setup.home_base': { en: 'Home base', pt: 'Base' },
  'setup.choose_role': {
    en: 'Choose this landmark’s role:',
    pt: 'Escolhe a função deste local:',
  },
  'setup.unassigned': { en: 'Unassigned', pt: 'Sem função' },
  'setup.progress': { en: '{count} of 5 assigned', pt: '{count} de 5 atribuídos' },
  'setup.selection_complete': { en: 'Ready', pt: 'Pronto' },
  'setup.step_photo': { en: 'Step 2', pt: 'Passo 2' },
}

export type MessageKey = keyof typeof MESSAGES

/**
 * Translate a key, with optional `{name}` token replacement. Falls back to
 * English if the key has no translation in the requested locale, or to the
 * key itself if no entry exists.
 */
export function translate(
  key: string,
  locale: Locale,
  tokens?: Record<string, string | number>,
): string {
  const entry = MESSAGES[key]
  let text: string
  if (!entry) {
    text = key
  } else {
    text = entry[locale] ?? entry.en ?? key
  }
  if (tokens) {
    for (const [k, v] of Object.entries(tokens)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}
