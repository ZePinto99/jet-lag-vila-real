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

export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: 'en',
  pt: 'pt-PT',
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
  'common.submitting': { en: 'Submitting…', pt: 'A submeter…' },
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
  'common.game': { en: 'Game', pt: 'Jogo' },
  'common.player': { en: 'Player', pt: 'Jogador' },

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
  'lobby.team_not_initialised': {
    en: 'Team not initialised yet…',
    pt: 'Equipa ainda não inicializada…',
  },
  'lobby.players_one': { en: '1 player', pt: '1 jogador' },
  'lobby.players_many': { en: '{n} players', pt: '{n} jogadores' },
  'lobby.you_are': { en: 'You are', pt: 'Tu és' },
  'lobby.on_side_west': { en: 'On West', pt: 'No Oeste' },
  'lobby.on_side_east': { en: 'On East', pt: 'no Este' },
  'lobby.switch_team': { en: 'Switch to other team', pt: 'Mudar de equipa' },
  'lobby.switching': { en: 'Switching…', pt: 'A mudar…' },
  'lobby.start_game': { en: 'Start game', pt: 'Começar jogo' },
  'lobby.starting': { en: 'Starting…', pt: 'A começar…' },
  'lobby.need_both_teams': {
    en: 'Both teams need at least one player.',
    pt: 'Ambas as equipas precisam de pelo menos um jogador.',
  },
  'lobby.need_team_sizes': {
    en: 'Teams must be equal, with 1–4 players on each side.',
    pt: 'As equipas têm de ser iguais, com 1–4 jogadores de cada lado.',
  },
  'lobby.other_team_full': {
    en: 'The other team is full (4 players).',
    pt: 'A outra equipa está cheia (4 jogadores).',
  },
  'lobby.need_all_ready': {
    en: 'All players must mark ready.',
    pt: 'Todos os jogadores têm de marcar pronto.',
  },
  'lobby.leave': { en: 'Leave game', pt: 'Sair do jogo' },
  'lobby.leaving': { en: 'Leaving…', pt: 'A sair…' },
  'lobby.kick_confirm': {
    en: 'Remove this player from the game?',
    pt: 'Remover este jogador do jogo?',
  },
  'lobby.leave_confirm': { en: 'Leave this game?', pt: 'Sair deste jogo?' },
  'lobby.kick_title': { en: 'Remove player?', pt: 'Remover jogador?' },
  'lobby.leave_title': { en: 'Leave game?', pt: 'Sair do jogo?' },
  'lobby.kick_action': { en: 'Remove', pt: 'Remover' },
  'lobby.leave_action': { en: 'Leave', pt: 'Sair' },
  'lobby.not_in_game': { en: 'You are not in this game.', pt: 'Não estás neste jogo.' },
  'lobby.join_this_game': { en: 'Join this game', pt: 'Entrar neste jogo' },
  'lobby.action_error': {
    en: 'Could not complete that action. Try again.',
    pt: 'Não foi possível concluir essa ação. Tenta novamente.',
  },

  // ---------- setup ----------
  'setup.title': { en: 'Setup phase', pt: 'Fase de preparação' },
  'setup.waiting_other': { en: 'Waiting for the other team…', pt: 'À espera da outra equipa…' },
  'setup.assignment_locked': {
    en: "Your team's flag assignment is locked in.",
    pt: 'A escolha da tua equipa está fechada.',
  },
  'setup.team_assignment_locked': {
    en: 'Team {side} — assignment locked in.',
    pt: 'Equipa {side} — escolha confirmada.',
  },
  'setup.both_done': {
    en: 'The other team has also submitted. The game will start shortly.',
    pt: 'A outra equipa também terminou. O jogo vai começar em instantes.',
  },
  'setup.your_landmarks': { en: 'Your landmarks', pt: 'Os teus locais' },
  'setup.submitted_at': { en: 'Submitted at {time}', pt: 'Submetido às {time}' },
  'setup.load_error': {
    en: 'Could not load setup state.',
    pt: 'Não foi possível carregar a preparação.',
  },
  'setup.submit_error': {
    en: 'Could not save the flag setup. Try again.',
    pt: 'Não foi possível guardar a preparação das bandeiras. Tenta novamente.',
  },
  'setup.intro_pt1': { en: 'You are Team', pt: 'Tu és da Equipa' },
  'setup.intro_pt2': {
    en: '. Walk to your home base with your team. When you are all there, decide together: 5 candidate landmarks — 1 real flag, 2 decoys, 2 empty.',
    pt: '. Caminhem até à base da equipa. Quando estiverem todos lá, decidam em conjunto: 5 locais candidatos — 1 bandeira verdadeira, 2 enganos, 2 vazios.',
  },
  'setup.counter': {
    en: 'Selected: {real} real (need 1) · {decoy} decoys (need 2) · {empty} empty (need 2) — {unused} unused',
    pt: 'Selecionados: {real} verdadeira (precisas de 1) · {decoy} enganos (precisas de 2) · {empty} vazios (precisas de 2) — {unused} por usar',
  },
  'setup.submit_assignment': { en: 'Submit assignment', pt: 'Submeter escolha' },
  'setup.role_none': { en: 'Clear', pt: 'Limpar' },
  'setup.surroundings_title': {
    en: 'Real-flag surroundings photo',
    pt: 'Foto dos arredores da bandeira real',
  },
  'setup.surroundings_hint': {
    en: 'Take one photo within 30 m of the real flag without showing the marker. It stays private unless the other team buys Surroundings intel.',
    pt: 'Tira uma foto a menos de 30 m da bandeira real sem mostrar o marcador. Fica privada, salvo se a outra equipa comprar a carta de intel «Arredores».',
  },
  'setup.surroundings_add': {
    en: '📷 Add surroundings photo',
    pt: '📷 Adicionar foto dos arredores',
  },
  'setup.surroundings_ready': {
    en: '✓ Surroundings photo ready',
    pt: '✓ Foto dos arredores pronta',
  },
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
  'live.title': { en: 'Live game', pt: 'Jogo em curso' },
  'live.load_error': {
    en: 'Could not load live state.',
    pt: 'Não foi possível carregar o estado do jogo.',
  },

  // ---------- live settings ----------
  'settings.open': { en: 'Open settings', pt: 'Abrir definições' },
  'settings.title': { en: 'Settings', pt: 'Definições' },
  'settings.preferences': { en: 'Preferences', pt: 'Preferências' },
  'settings.map': { en: 'Map', pt: 'Mapa' },
  'settings.language': { en: 'Language', pt: 'Idioma' },
  'settings.sound': { en: 'Sound', pt: 'Som' },
  'settings.notifications': { en: 'Notifications', pt: 'Notificações' },
  'settings.notifications_on': {
    en: 'Lock-screen notifications are on',
    pt: 'Notificações no ecrã bloqueado ativas',
  },
  'settings.notifications_unavailable': {
    en: 'Not available on this device',
    pt: 'Não disponível neste dispositivo',
  },
  'settings.gps': { en: 'Location', pt: 'Localização' },
  'settings.gps_accuracy': { en: 'Accuracy ±{m} m', pt: 'Precisão ±{m} m' },
  'settings.gps_error': { en: 'GPS error: {error}', pt: 'Erro de GPS: {error}' },
  'gps.error_permission_denied': {
    en: 'location permission denied',
    pt: 'permissão de localização recusada',
  },
  'gps.error_unavailable': {
    en: 'position unavailable',
    pt: 'posição indisponível',
  },
  'gps.error_timeout': {
    en: 'location request timed out',
    pt: 'tempo de localização esgotado',
  },
  'gps.error_unsupported': {
    en: 'location is not supported on this device',
    pt: 'localização não suportada neste dispositivo',
  },
  'gps.error_generic': {
    en: 'could not determine your position',
    pt: 'não foi possível determinar a tua posição',
  },
  'settings.gps_acquiring': { en: 'Acquiring position…', pt: 'A obter posição…' },
  'settings.gps_updating': { en: 'Updating position…', pt: 'A atualizar posição…' },
  'settings.intel_filter': { en: 'Intel Filter', pt: 'Filtro de Intel' },
  'settings.intel_filter_hint': {
    en: 'Dim locations ruled out by your clues',
    pt: 'Escurece os locais excluídos pelas tuas pistas',
  },
  'settings.intel_filter_unavailable': {
    en: 'Buy map-based intel to reveal ruled-out areas',
    pt: 'Compra intel de mapa para revelar áreas excluídas',
  },

  // ---------- map controls ----------
  'map.fit_vila_real': { en: 'View play area', pt: 'Ver área de jogo' },
  'map.recenter_on_me': { en: 'Recenter on me', pt: 'Centrar em mim' },
  'map.show_return_edge': { en: 'Show return edge', pt: 'Ver ponto de regresso' },
  'map.intel_filter_off': { en: 'Intel filter OFF', pt: 'Filtro de intel DESL.' },
  'map.intel_filter_on': { en: 'Intel filter ON ({n})', pt: 'Filtro de intel LIG. ({n})' },
  'map.legend_title': { en: 'Legend', pt: 'Legenda' },
  'map.legend_your_team': { en: 'Your team', pt: 'A tua equipa' },
  'map.legend_enemy_team': { en: 'Enemy team', pt: 'Equipa adversária' },
  'map.legend_neutral': { en: 'Neutral', pt: 'Neutro' },
  'map.legend_you': { en: 'You', pt: 'Tu' },
  'map.you_outside': { en: 'You · {m} m outside', pt: 'Tu · {m} m fora' },
  'map.walking_directions': { en: 'Walking directions', pt: 'Direções a pé' },
  'map.your_candidate': { en: 'your candidate', pt: 'teu local candidato' },
  'map.enemy_candidate': { en: 'enemy candidate', pt: 'local candidato adversário' },
  'map.your_home': { en: 'your home base', pt: 'tua base' },
  'map.enemy_home': { en: 'enemy home base', pt: 'base adversária' },
  'map.neutral_landmark': { en: 'Neutral landmark', pt: 'Marco neutro' },
  'map.unknown_attempt': {
    en: 'Unknown — attempt to discover',
    pt: 'Desconhecido — tenta descobrir',
  },
  'map.ruled_out': { en: 'Ruled out by intel', pt: 'Excluído por intel' },
  'map.confirmed': { en: 'Confirmed: {kind}', pt: 'Confirmado: {kind}' },
  'map.real_flag': { en: 'Real flag', pt: 'Bandeira verdadeira' },
  'map.decoy': { en: 'Decoy', pt: 'Engano' },
  'map.empty': { en: 'Empty', pt: 'Vazio' },
  'map.home_base': { en: 'Home base', pt: 'Base' },
  'map.safe_respawn': { en: 'Safe respawn point', pt: 'Ponto seguro de regresso' },
  'map.your_home_status': {
    en: 'Your home base. Return here with the enemy flag to win.',
    pt: 'A tua base. Regressa aqui com a bandeira adversária para ganhar.',
  },
  'map.enemy_home_status': { en: 'Enemy home base.', pt: 'Base adversária.' },
  'map.attempts_locked': {
    en: '🔒 Attempts locked (first 30 min)',
    pt: '🔒 Tentativas bloqueadas (primeiros 30 min)',
  },
  'map.eliminated': { en: 'Eliminated: {kind}', pt: 'Eliminado: {kind}' },
  'map.eliminated_locked': {
    en: 'Eliminated ({kind}) · locked {time}',
    pt: 'Eliminado ({kind}) · bloqueado {time}',
  },
  'map.teammate': { en: 'Team-mate', pt: 'Colega de equipa' },
  'map.enemy_raider': {
    en: 'Enemy raider in your zone',
    pt: 'Invasor adversário na tua zona',
  },

  // ---------- tag + respawn ----------
  'tag.button_enabled': { en: 'TAG ({n} within {m} m)', pt: 'APANHAR ({n} a menos de {m} m)' },
  'tag.button_disabled': { en: 'TAG', pt: 'APANHAR' },
  // Plural forms are spelled out rather than "player(s)": this is the button's
  // accessible name, so a screen reader speaks it verbatim and "player open
  // paren s close paren" is not acceptable output.
  'tag.aria_enabled_one': {
    en: 'Tag 1 player within {m} metres',
    pt: 'Apanhar 1 jogador a menos de {m} metros',
  },
  'tag.aria_enabled_many': {
    en: 'Tag {n} players within {m} metres',
    pt: 'Apanhar {n} jogadores a menos de {m} metros',
  },
  'tag.aria_disabled': { en: 'Tag button disabled', pt: 'Botão de captura desativado' },
  'tag.reason_no_gps': { en: 'Enable GPS to tag', pt: 'Ativa o GPS para apanhar' },
  'tag.reason_respawning': { en: 'You are respawning', pt: 'Estás a regressar ao jogo' },
  'tag.reason_out_of_zone': { en: 'Not in your defense zone', pt: 'Fora da tua zona de defesa' },
  'tag.reason_no_enemies': { en: 'No enemies within 5 m', pt: 'Sem adversários a menos de 5 m' },
  'tag.reason_camping': {
    en: 'Camping locked — leave own landmark to reset',
    pt: 'Bloqueado por acampamento — afasta-te do teu local para reiniciar',
  },
  'tag.zone_ready': {
    en: 'Defense zone · Tag ready if a raider comes within 5 m',
    pt: 'Zona de defesa · Captura pronta se um invasor chegar a 5 m',
  },
  'tag.action_error': {
    en: 'Could not complete the tag. Try again.',
    pt: 'Não foi possível concluir a captura. Tenta novamente.',
  },

  // Camping banner (P8). Both thresholds are counted server-side from position
  // heartbeats, so the warning survives a reload — but it can only be SHOWN to
  // an app that is open, which the copy has to be honest about.
  'camping.warning': {
    en: 'Camping warning — {s}s until your Tag button switches off',
    pt: 'Aviso de acampamento — faltam {s}s para o teu botão de captura se desligar',
  },
  'camping.warning_imminent': {
    en: 'Camping — Tag switches off now. Leave your own landmark.',
    pt: 'Acampamento — a captura desliga-se agora. Afasta-te do teu local.',
  },
  'camping.locked': {
    en: 'Camping locked — leave your own landmark for {s}s to reset',
    pt: 'Bloqueado por acampamento — afasta-te do teu local durante {s}s para reiniciar',
  },
  'camping.locked_progress': {
    en: 'Camping locked — {s}s more away from your own landmark',
    pt: 'Bloqueado por acampamento — permanece mais {s}s longe do teu local',
  },
  // Singular and plural spelled out rather than "player(s)" — this copy is read
  // by a player mid-walk and spoken by screen readers.
  'tag.confirm_one': { en: 'Tag 1 player?', pt: 'Apanhar 1 jogador?' },
  'tag.confirm_many': { en: 'Tag {n} players?', pt: 'Apanhar {n} jogadores?' },
  'tag.success_one': { en: 'Tagged 1 player', pt: 'Apanhaste 1 jogador' },
  'tag.success_many': { en: 'Tagged {n} players', pt: 'Apanhaste {n} jogadores' },

  // Tag outcome copy (P12). A tap that lands nothing must always say why:
  // "no tags landed" with no cause reads as a broken button.
  'tag.result_tagged_one': { en: 'Tagged 1 player.', pt: 'Apanhaste 1 jogador.' },
  'tag.result_tagged_many': { en: 'Tagged {n} players.', pt: 'Apanhaste {n} jogadores.' },
  // 0058: the tag fine. Shown after a successful tag so the defender sees the
  // cost landed, and the _broke variant so a 0-coin fine reads as "they had
  // nothing" rather than looking like the tag failed.
  'tag.result_fined': { en: 'Fined them {c} coins.', pt: 'Multa de {c} moedas.' },
  'tag.result_fined_broke': {
    en: 'They had no coins left to fine.',
    pt: 'Não tinham moedas para multar.',
  },
  'tag.result_none': { en: 'No tags landed.', pt: 'Nenhuma captura foi aplicada.' },
  'tag.result_rejected_count': { en: '({n} rejected)', pt: '({n} rejeitadas)' },
  // Single target that was already down by the time the tap reached the server.
  'tag.reject_already_respawning': {
    en: 'They had already been tagged and are respawning — nothing to apply.',
    pt: 'Já tinham sido apanhados e estão a regressar ao jogo — não há nada para aplicar.',
  },
  // Multi-target batch: someone else's tag landed first, so the whole batch was
  // rolled back. Nothing was applied, so retrying is the right move.
  'tag.reject_batch_aborted': {
    en: 'Someone else tagged one of them first, so nothing was applied. Tap again to catch the rest.',
    pt: 'Outra pessoa apanhou um deles primeiro, por isso nada foi aplicado. Toca outra vez para apanhar os restantes.',
  },
  'tag.reject_out_of_range': {
    en: 'They moved out of range before the tag landed.',
    pt: 'Afastaram-se do alcance antes de a captura ser aplicada.',
  },
  'tag.reject_stale_position': {
    en: 'Their position was too old to trust — wait for a fresh GPS fix.',
    pt: 'A posição deles estava demasiado antiga — espera por um sinal de GPS novo.',
  },
  'tag.reject_target_not_raider': {
    en: 'They count as a defender right now, not a raider.',
    pt: 'Neste momento contam como defensores, não como invasores.',
  },
  'tag.reject_wrong_team_or_missing': {
    en: 'That player is no longer a valid target.',
    pt: 'Esse jogador já não é um alvo válido.',
  },
  'tag.reject_generic': {
    en: 'One tag was rejected ({reason}).',
    pt: 'Uma captura foi rejeitada ({reason}).',
  },

  // Flag carrier stripped by a tag (P2, RULEBOOK §6). Pending implementation —
  // these are the strings the stripped carrier and the defender will see.
  'tag.carrier_stripped': {
    en: 'You tagged the flag carrier — their run is over and nobody is carrying the flag.',
    pt: 'Apanhaste quem levava a bandeira — a corrida deles acabou e ninguém está a levar a bandeira.',
  },
  'respawn.flag_lost': {
    en: 'You were carrying the flag and lost it. The photo still counts, but your team has to photograph the real flag again to win.',
    pt: 'Estavas a levar a bandeira e perdeste-a. A foto continua a contar, mas a tua equipa tem de fotografar outra vez a bandeira verdadeira para ganhar.',
  },

  'respawn.title': { en: 'You were tagged.', pt: 'Foste apanhado.' },
  // The examples must be real `team_pool: "neutral"` landmarks from
  // data/landmarks.json. This string previously offered "Sé" — which is an EAST
  // candidate, not a neutral — so a tagged player could walk there in good faith
  // and be refused by the geofence. The app assigns the specific landmark anyway;
  // these are only illustrations of the kind of place to look for.
  'respawn.body': {
    en: 'Walk to a NEUTRAL landmark (Pelourinho, Capela Nova, Teatro, Rodoviária) and tap below when you arrive.',
    pt: 'Caminha até um marco NEUTRO (Pelourinho, Capela Nova, Teatro, Rodoviária) e toca abaixo quando lá chegares.',
  },
  'respawn.button': { en: "I'm at a neutral landmark", pt: 'Estou num marco neutro' },
  'respawn.need_gps': {
    en: 'Enable GPS to confirm position',
    pt: 'Ativa o GPS para confirmar a posição',
  },
  'respawn.too_far': {
    en: "You're {m} m from the nearest neutral — keep walking.",
    pt: 'Estás a {m} m do marco neutro mais próximo — continua a andar.',
  },

  // ---------- flag attempt / carrier / found ----------
  'flag_attempt.button_enabled': {
    en: 'ATTEMPT FLAG · {name} ({m} m)',
    pt: 'TENTAR BANDEIRA · {name} ({m} m)',
  },
  'flag_attempt.button_disabled': { en: 'ATTEMPT FLAG', pt: 'TENTAR BANDEIRA' },
  'flag_attempt.reason_no_gps': { en: 'Enable GPS to attempt', pt: 'Ativa o GPS para tentar' },
  'flag_attempt.reason_respawning': {
    en: 'You are respawning',
    pt: 'Estás a regressar ao jogo',
  },
  'flag_attempt.reason_not_live': {
    en: 'Available during live game',
    pt: 'Disponível durante o jogo',
  },
  'flag_attempt.reason_out_of_range': {
    en: 'Move within {m} m of an enemy candidate',
    pt: 'Aproxima-te a {m} m de um local adversário',
  },
  'flag_attempt.reason_discovered': { en: 'Already discovered', pt: 'Já descoberto' },
  'flag_attempt.approaching': {
    en: 'Enemy candidate ahead · {name} · {m} m',
    pt: 'Local adversário próximo · {name} · {m} m',
  },
  'flag_attempt.aria_target': {
    en: 'Attempt flag at {name}, {distance} away',
    pt: 'Tentar bandeira em {name}, a {distance}',
  },
  'flag_attempt.aria_disabled': {
    en: 'Flag attempt button disabled',
    pt: 'Botão de tentativa de bandeira desativado',
  },
  'flag_attempt.take_photo': {
    en: '📷 Take / choose photo',
    pt: '📷 Tirar / escolher foto',
  },
  'flag_attempt.reacquiring': {
    en: 'Reacquiring GPS — your photo and answer are safe.',
    pt: 'A atualizar o GPS — a tua foto e resposta estão guardadas.',
  },
  'flag_attempt.confirm': { en: 'Attempt flag at {name}?', pt: 'Tentar bandeira em {name}?' },
  'flag_attempt.toast_real': {
    en: 'REAL FLAG — RUN HOME!',
    pt: 'BANDEIRA REAL — CORRE PARA CASA!',
  },
  'flag_attempt.toast_decoy': {
    en: 'Decoy! All intel lost.',
    pt: 'Engano! Perdeste todas as cartas de intel.',
  },
  'flag_attempt.toast_empty': { en: 'Empty. Nothing here.', pt: 'Vazio. Nada aqui.' },
  'flag_carrier.title': { en: 'YOU HAVE THE FLAG', pt: 'TENS A BANDEIRA' },
  'flag_carrier.run_to': { en: 'Run to {name}', pt: 'Corre para {name}' },
  'flag_carrier.distance': { en: '~{m} m away', pt: 'a ~{m} m' },
  'flag_carrier.submitting': { en: 'Submitting…', pt: 'A submeter…' },
  'flag_found.team_msg': {
    en: 'Your team found the flag! {name} is running to home base.',
    pt: 'A tua equipa encontrou a bandeira! {name} corre para a base.',
  },
  'flag_found.enemy_msg': {
    en: 'Enemy found your flag! {name} is running to {home}. Intercept them!',
    pt: 'O adversário encontrou a vossa bandeira! {name} corre para {home}. Intercetem-no!',
  },

  // ---------- game over ----------
  'gameover.tag': { en: 'Game over', pt: 'Fim de jogo' },
  'gameover.wins': { en: '{team} wins!', pt: '{team} ganhou!' },
  'gameover.tie': { en: 'Tie game', pt: 'Empate' },
  'gameover.reason_flag_returned': {
    en: 'Flag returned to home base',
    pt: 'Bandeira entregue na base',
  },
  'gameover.reason_timeout_points': {
    en: 'Won on points after 3-hour timeout',
    pt: 'Vencedor por pontos após 3 horas',
  },
  'gameover.reason_timeout_tiebreaker': {
    en: 'Won on tiebreaker after 3-hour timeout',
    pt: 'Vencedor por desempate após 3 horas',
  },
  'gameover.reason_timeout_tied': {
    en: 'Tied — all tiebreakers exhausted',
    pt: 'Empate — todos os desempates esgotados',
  },
  'gameover.reason_timeout_coin_flip': {
    en: 'Won by coin flip after all tiebreakers were tied',
    pt: 'Vencedor por lançamento de moeda após todos os desempates',
  },
  'gameover.you_won': { en: 'Congratulations.', pt: 'Parabéns.' },
  'gameover.you_lost': { en: 'Better luck next round.', pt: 'Para a próxima.' },
  'gameover.row_real_flag': { en: 'Real flag photographed', pt: 'Bandeira fotografada' },
  'gameover.row_challenges': { en: 'Challenges completed', pt: 'Desafios concluídos' },
  'gameover.row_tags': { en: 'Tags made', pt: 'Capturas' },
  'gameover.row_curses': { en: 'Curses cast (stat)', pt: 'Maldições lançadas (estatística)' },
  'gameover.row_coins': { en: 'Coins (tiebreaker)', pt: 'Moedas (desempate)' },
  'gameover.row_total': { en: 'Total', pt: 'Total' },
  'gameover.winner_badge': { en: 'winner', pt: 'vencedor' },
  'gameover.recent_events': { en: 'Last 20 events', pt: 'Últimos 20 eventos' },
  'gameover.view_timeline': { en: 'View full timeline', pt: 'Ver cronologia completa' },
  'gameover.no_events': { en: 'No events recorded.', pt: 'Sem eventos registados.' },

  // ---------- actions tab: intel ----------
  'intel.panel_title': { en: 'Buy Intel', pt: 'Comprar Intel' },
  'intel.cap': { en: '{used}/{cap} cards held', pt: '{used}/{cap} cartas na mão' },
  'intel.buy': { en: 'Buy', pt: 'Comprar' },
  'intel.buying': { en: 'Buying…', pt: 'A comprar…' },
  'intel.confirm': { en: 'Buy {name} for {cost} coins?', pt: 'Comprar {name} por {cost} moedas?' },
  'intel.reason_not_live': { en: 'Available during live game', pt: 'Disponível durante o jogo' },
  'intel.reason_already_purchased': { en: 'Already purchased', pt: 'Já comprado' },
  'intel.reason_cap_reached': {
    en: 'Intel hand limit reached (4)',
    pt: 'Limite de 4 cartas de intel atingido',
  },
  'intel.reason_insufficient': { en: 'Need {n} more coins', pt: 'Faltam {n} moedas' },
  'intel.reason_needs_gps': { en: 'Enable GPS to buy', pt: 'Ativa o GPS para comprar' },
  'intel.acquired': {
    en: 'Intel acquired — see Status tab',
    pt: 'Carta de intel adquirida — vê o separador Estado',
  },
  'intel.panel_hint': {
    en: 'Each card reveals one clue about the enemy real flag. Your team may hold 4 at once; a lost card frees a slot, but the same card cannot be bought twice.',
    pt: 'Cada carta revela uma pista sobre a bandeira verdadeira adversária. A equipa pode ter 4 ao mesmo tempo; uma carta perdida liberta um espaço, mas a mesma carta não pode ser comprada duas vezes.',
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
  'curse.confirm': {
    en: 'Cast a curse using {dice}? Cost: {cost} coins.',
    pt: 'Lançar maldição com {dice}? Custo: {cost} moedas.',
  },
  'curse.reason_not_live': { en: 'Available during live game', pt: 'Disponível durante o jogo' },
  'curse.reason_insufficient': { en: 'Need {n} more coins', pt: 'Faltam {n} moedas' },
  'curse.rolled': {
    en: 'Rolled: {rolls} = {total} ({tier})',
    pt: 'Lançamento: {rolls} = {total} ({tier})',
  },
  'curse.tier_minor': { en: 'minor', pt: 'ligeira' },
  'curse.tier_medium': { en: 'medium', pt: 'média' },
  'curse.tier_major': { en: 'major', pt: 'grave' },
  'curse.dismiss': { en: 'Dismiss', pt: 'Dispensar' },
  'curse.banner_title': { en: 'Curses on us', pt: 'Maldições em nós' },
  'curse.expired_hint': { en: '(expired — refreshing…)', pt: '(expirada — a atualizar…)' },
  'curse.rolling': { en: 'Rolling…', pt: 'A lançar…' },
  'curse.duration': { en: 'Duration: {n} min', pt: 'Duração: {n} min' },
  'curse.ledger_coin_drain': {
    en: 'Enemy team lost {amount} coins (now {balance}).',
    pt: 'A equipa adversária perdeu {amount} moedas (tem agora {balance}).',
  },
  'curse.ledger_intel_loss': {
    en: 'Enemy team lost an intel card ({name}).',
    pt: 'A equipa adversária perdeu uma carta de intel ({name}).',
  },
  'curse.ledger_no_intel': {
    en: 'Enemy team had no intel cards to lose.',
    pt: 'A equipa adversária não tinha cartas de intel para perder.',
  },
  'curse.ledger_full_stop': {
    en: 'Enemy team is locked out of app actions for the duration.',
    pt: 'As ações da app da equipa adversária ficam bloqueadas durante a maldição.',
  },
  'curse.ledger_check_in': {
    en: 'Affected players acknowledge in-app prompts every 2 minutes. Honour-based — nothing is recorded.',
    pt: 'Os jogadores afetados confirmam avisos da app a cada 2 minutos. Baseia-se na confiança — nada fica registado.',
  },

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
  'challenge.reason_not_live': {
    en: 'Available during live game',
    pt: 'Disponível durante o jogo',
  },
  'challenge.reason_respawning': {
    en: 'You are respawning',
    pt: 'Estás a regressar ao jogo',
  },
  'challenge.reason_no_gps': { en: 'Enable GPS', pt: 'Ativa o GPS' },
  'challenge.reason_too_far': {
    en: 'Get closer (currently {m})',
    pt: 'Aproxima-te (atualmente a {m})',
  },
  'challenge.toast_reward': { en: '+{n} coins', pt: '+{n} moedas' },
  'challenge.toast_first_blood': { en: ' (+30 first blood!)', pt: ' (+30 primeiro sangue!)' },
  'challenge.history_title': { en: 'Challenge history', pt: 'Histórico de desafios' },
  'challenge.history_empty': {
    en: 'No challenges completed yet.',
    pt: 'Ainda não há desafios concluídos.',
  },
  'challenge.loading': { en: 'Loading challenges…', pt: 'A carregar desafios…' },
  'challenge.none_active': {
    en: 'No active challenges right now.',
    pt: 'Não há desafios ativos neste momento.',
  },
  'challenge.submission_required': {
    en: 'A submission is required for this challenge.',
    pt: 'Este desafio exige uma resposta.',
  },
  'challenge.answer_windows': { en: 'How many windows? (number)', pt: 'Quantas janelas? (número)' },
  'challenge.answer_rivers': { en: 'Name the two rivers', pt: 'Indica os dois rios' },
  'challenge.answer_latin': {
    en: 'Latin name from the placard',
    pt: 'Nome em latim indicado na placa',
  },
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
  'status.harden_action': {
    en: 'Harden flag · {cost} coins',
    pt: 'Reforçar bandeira · {cost} moedas',
  },
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
  'status.harden_no_flag': {
    en: 'No real flag assigned yet',
    pt: 'Ainda não há bandeira verdadeira atribuída',
  },
  'status.harden_unavailable': {
    en: 'Not available right now',
    pt: 'Não disponível neste momento',
  },
  'status.harden_cost': {
    en: 'Costs {cost} coins — you have {coins}',
    pt: 'Custa {cost} moedas — tens {coins}',
  },
  'status.curse_received': { en: 'Curse received: {name}', pt: 'Maldição recebida: {name}' },
  'status.curse_expired': { en: 'Curse expired: {name}', pt: 'Maldição terminada: {name}' },
  'status.coin_drain': { en: 'Coin drain: -{n} coins', pt: 'Dreno de moedas: -{n} moedas' },
  'status.coin_drain_applied': { en: 'Coin drain applied', pt: 'Dreno de moedas aplicado' },
  'status.intel_lost': {
    en: 'Intel lost: {name}',
    pt: 'Carta de intel perdida: {name}',
  },
  'status.intel_lost_generic': { en: 'Intel lost', pt: 'Carta de intel perdida' },
  'status.proof_submitted': {
    en: 'Proof submitted: {name}{index}',
    pt: 'Prova submetida: {name}{index}',
  },
  'status.first_blood': { en: 'first blood', pt: 'primeiro sangue' },
  'status.intel_cards_title': { en: 'My intel cards', pt: 'As minhas cartas de intel' },
  'status.intel_cards_empty': {
    en: 'No intel purchased yet. Buy intel from the Actions tab.',
    pt: 'Ainda não compraste intel. Compra-a no separador Ações.',
  },
  'status.real_flag_north_south': {
    en: 'Real flag is to the {direction} of the city centre.',
    pt: 'A bandeira verdadeira fica a {direction} do centro da cidade.',
  },
  'status.not_real': {
    en: '{name} is NOT the real flag.',
    pt: '{name} NÃO tem a bandeira verdadeira.',
  },
  'status.not_real_two': {
    en: '{first} and {second} are NOT the real flag.',
    pt: '{first} e {second} NÃO têm a bandeira verdadeira.',
  },
  'status.is_decoy': { en: '{name} is a decoy.', pt: '{name} é um engano.' },
  'status.hot_cold_bought': {
    en: 'Real flag distance when bought: {bucket}',
    pt: 'Distância à bandeira quando compraste: {bucket}',
  },
  'status.enable_gps_live': {
    en: ' · enable GPS for a live reading',
    pt: ' · ativa o GPS para uma leitura em direto',
  },
  'status.surroundings': {
    en: 'Surroundings near the real flag:',
    pt: 'Arredores da bandeira verdadeira:',
  },
  'status.surroundings_alt': {
    en: 'Surroundings near the enemy real flag',
    pt: 'Arredores da bandeira verdadeira adversária',
  },
  'status.bearing': {
    en: 'Bearing from city centre: {bearing}',
    pt: 'Direção a partir do centro da cidade: {bearing}',
  },
  'status.unknown_intel': { en: '(unknown intel)', pt: '(carta de intel desconhecida)' },

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
  'curse.readout_quarantine': {
    en: 'Quarantine spread {m} m',
    pt: 'Dispersão na quarentena {m} m',
  },
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

  // Proof-window pre-warning + closing alert (P14). Photo curses open narrow
  // slots (Outfit Swap's second slot is 60 s, 19 min after the cast) and a
  // missed slot cannot be reopened, so the window must be impossible to miss by
  // accident. Copy only — no penalty is attached to a miss.
  'curse.proof_upcoming': {
    en: 'Photo needed in {s}s — get ready.',
    pt: 'Foto necessária dentro de {s}s — prepara-te.',
  },
  'curse.proof_upcoming_min': {
    en: 'Photo needed in {m}m {s}s — get ready.',
    pt: 'Foto necessária dentro de {m}m {s}s — prepara-te.',
  },
  'curse.proof_closing': {
    en: 'Last {s}s to submit this photo — it cannot be reopened.',
    pt: 'Últimos {s}s para submeter esta foto — não pode ser reaberta.',
  },
  'curse.proof_window_hint': {
    en: 'This is the only slot for this photo. Miss it and it stays missed.',
    pt: 'Esta é a única janela para esta foto. Se a perderes, fica perdida.',
  },

  // ---------- flag attempt window / lockout (P2-1 / P2-3 / P2-4) ----------
  'attempt.locked_window': {
    en: 'Attempts unlock in {time}',
    pt: 'Tentativas disponíveis dentro de {time}',
  },
  'attempt.window_header': {
    en: 'Flag attempts unlock in {time}',
    pt: 'Tentativas à bandeira disponíveis dentro de {time}',
  },
  'attempt.err_attempts_locked': {
    en: 'Flag attempts are locked for the first 30 minutes.',
    pt: 'As tentativas à bandeira estão bloqueadas nos primeiros 30 minutos.',
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
  'attempt.err_generic': {
    en: 'Could not complete the flag attempt. Try again.',
    pt: 'Não foi possível concluir a tentativa à bandeira. Tenta novamente.',
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
  'moment.tag_made.title': { en: 'RAIDER TAGGED!', pt: 'ATACANTE APANHADO!' },
  // 0058: a tag fines coins, it does NOT take intel. This subtitle said
  // "they lose intel" and was shown live, mid-game, to the whole team.
  'moment.tag_made.sub': {
    en: '{tagger} tagged {raider} — their team is fined and they must respawn',
    pt: '{tagger} apanhou {raider} — a equipa adversária é multada e o jogador tem de regressar ao jogo',
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

  // Out-of-bounds warnings (RULEBOOK §12.1). Warning only, never a penalty.
  'bounds.near_edge': {
    en: '⚠️ Approaching the play-area edge · {m} m',
    pt: '⚠️ Limite da área de jogo a {m} m',
  },
  'bounds.outside': {
    en: '🛑 Outside the play area · {m} m back',
    pt: '🛑 Fora da área de jogo · regressa {m} m',
  },
  'bounds.near_edge_announcement': {
    en: 'Approaching the play-area edge.',
    pt: 'A aproximar-te do limite da área de jogo.',
  },
  'bounds.outside_announcement': {
    en: 'Outside the play area.',
    pt: 'Fora da área de jogo.',
  },
  'bounds.returned_announcement': {
    en: 'Back inside the play area.',
    pt: 'Regressaste à área de jogo.',
  },
  'bounds.directions_back': { en: 'Directions back', pt: 'Percurso de regresso' },

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
  'recap.mvp_tags': { en: '{count} tags made', pt: '{count} capturas' },
  'recap.no_mvp': { en: 'No tags this match', pt: 'Nenhuma captura neste jogo' },
  'recap.you': { en: 'you', pt: 'tu' },
  'recap.first_blood': { en: 'First blood', pt: 'Primeiro sangue' },
  'recap.no_first_blood': {
    en: 'No challenges completed',
    pt: 'Nenhum desafio concluído',
  },
  'recap.stat_tags': { en: 'Tags', pt: 'Capturas' },
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
    pt: 'Regresso ao jogo obrigatório — chega ao ponto neutro atribuído e afasta-te antes de usar ações do jogo.',
  },
  'respawn.assigned_neutral': {
    en: 'the assigned neutral landmark',
    pt: 'o ponto neutro atribuído',
  },
  'respawn.target_hint': {
    en: 'Your required respawn point is {target}. Go there, then confirm your arrival.',
    pt: 'O teu ponto de regresso obrigatório é {target}. Vai até lá e confirma a chegada.',
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

  // Stuck-respawn clarity (P7). There is no respawn timeout: nothing clears this
  // state except the player walking to the target and confirming. So the banner
  // has to state the lock, the live distance, and the exact way out.
  'respawn.locked_notice': {
    en: 'You cannot tag, buy, or complete anything until this is done.',
    pt: 'Não podes apanhar, comprar nem concluir nada até isto estar feito.',
  },
  'respawn.distance_to_target': {
    en: '{distance} m to {target}',
    pt: '{distance} m até {target}',
  },
  'respawn.distance_unknown': {
    en: 'Distance unavailable — waiting for a GPS fix.',
    pt: 'Distância indisponível — à espera de sinal de GPS.',
  },
  'respawn.leave_progress': {
    en: '{distance} m from {target} — {needed} m needed.',
    pt: '{distance} m de {target} — faltam {needed} m.',
  },
  'respawn.leave_ready': {
    en: 'Far enough from {target} — confirm to rejoin.',
    pt: 'Já estás longe de {target} — confirma para voltares ao jogo.',
  },
  // Migration 0055 added a 10-minute grace sweep and a host override, which
  // replaced the previous 'respawn.no_timeout_hint' string ("This does not time
  // out… nothing else clears it"). That string had become false: it told a player
  // whose GPS would not confirm that their evening was over, 30 seconds before the
  // sweep would have released them — the exact failure 0055 exists to prevent.
  // Walking is still strictly better than waiting (10 min is longer than any real
  // walk to a neutral landmark), so the copy leads with walking.
  // Host override for a stuck respawn (finding P7, migration 0055). Only shown
  // to the host, and only while someone is actually respawning.
  // Flag-carrier strip (finding P2, migration 0053). Both teams are told: it
  // changes what each should do next — the losers must photograph the flag again,
  // the defenders know their interception actually worked.
  'toast.you_lost_the_flag': {
    en: 'Tagged — you dropped the flag. Someone must photograph it again.',
    pt: 'Apanhado — perdeste a bandeira. Alguém tem de a fotografar outra vez.',
  },
  'toast.teammate_lost_the_flag': {
    en: '{player} was tagged and dropped the flag. It must be photographed again.',
    pt: '{player} foi apanhado e perdeu a bandeira. Tem de ser fotografada outra vez.',
  },
  'toast.we_stripped_the_flag': {
    en: 'Tag landed — the carrier dropped your flag. Their run is over.',
    pt: 'Captura feita — o portador largou a vossa bandeira. A corrida dele acabou.',
  },

  'host_respawn.title': { en: 'Release a stuck player', pt: 'Libertar um jogador preso' },
  'host_respawn.hint': {
    en: 'Only if their GPS will not confirm. Walking to the neutral landmark is the normal way out, and this clears on its own after 10 minutes.',
    pt: 'Apenas se o GPS não confirmar. Ir a pé até ao marco neutro é a saída normal, e isto resolve-se sozinho após 10 minutos.',
  },
  'host_respawn.arrived': { en: 'arrived, walking clear', pt: 'chegou, a afastar-se' },
  'host_respawn.release': { en: 'Release', pt: 'Libertar' },
  'host_respawn.confirm': { en: 'Confirm release', pt: 'Confirmar' },
  'host_respawn.cancel': { en: 'Cancel', pt: 'Cancelar' },
  'host_respawn.releasing': { en: 'Releasing…', pt: 'A libertar…' },
  'host_respawn.failed': {
    en: 'Could not release ({reason})',
    pt: 'Não foi possível libertar ({reason})',
  },

  'respawn.timeout_hint': {
    en: 'Walking there is the fastest way out. If GPS will not confirm, this clears on its own after 10 minutes, or the host can release you.',
    pt: 'Ir a pé até lá é a saída mais rápida. Se o GPS não confirmar, isto resolve-se sozinho após 10 minutos, ou o anfitrião pode libertar-te.',
  },
  'respawn.gps_stuck_hint': {
    en: 'If GPS will not confirm you at {target}, walk a few steps and try again, or agree it with the other team.',
    pt: 'Se o GPS não te confirmar em {target}, dá alguns passos e tenta outra vez, ou combina com a outra equipa.',
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

  // ---------- player guide (/guide) ----------
  //
  // Every number in this block is interpolated from lib/gameConstants.ts or the
  // seed data — never typed into the string — so a balance change cannot leave
  // the guide lying to players.

  'landing.player_guide': { en: 'How to play', pt: 'Como se joga' },
  'landing.player_guide_desc': {
    en: 'Illustrated guide — read it before you start',
    pt: 'Guia ilustrado — lê antes de começar',
  },

  'guide.title': { en: 'How to play', pt: 'Como se joga' },
  'guide.subtitle': {
    en: 'Walk. Hunt. Photograph the flag. Get home.',
    pt: 'Anda. Caça. Fotografa a bandeira. Volta a casa.',
  },
  'guide.back': { en: 'Back', pt: 'Voltar' },
  'guide.jump_to': { en: 'Jump to', pt: 'Ir para' },
  'guide.to_top': { en: 'Back to top', pt: 'Voltar ao topo' },
  'guide.in_app_hint': {
    en: 'Full lists with live prices are in the game itself — this guide teaches the rules behind them.',
    pt: 'As listas completas com preços atuais estão no próprio jogo — este guia ensina as regras por trás delas.',
  },

  // -- 1. the game in 60 seconds --
  'guide.sixty.nav': { en: '60 seconds', pt: '60 segundos' },
  'guide.sixty.heading': { en: 'The game in 60 seconds', pt: 'O jogo em 60 segundos' },
  'guide.sixty.goal': {
    en: 'Two teams. Each hides one real flag among five candidate landmarks. First team to photograph the enemy’s real flag and walk it back to their own home base wins.',
    pt: 'Duas equipas. Cada uma esconde uma bandeira verdadeira entre cinco locais candidatos. Ganha a primeira equipa que fotografar a bandeira verdadeira do adversário e a levar até à sua própria base.',
  },
  'guide.sixty.walking': {
    en: 'On foot only — no buses, taxis, scooters or lifts.',
    pt: 'Só a pé — sem autocarros, táxis, trotinetes ou boleias.',
  },
  'guide.sixty.referee': {
    en: 'The app is the referee. It checks your GPS, holds the coins and decides tags — there is no human judge to argue with.',
    pt: 'A app é o árbitro. Verifica o teu GPS, guarda as moedas e decide as capturas — não há juiz humano com quem discutir.',
  },
  'guide.sixty.stat_duration': { en: '{n} h', pt: '{n} h' },
  'guide.sixty.stat_duration_label': { en: 'on the clock', pt: 'de jogo' },
  'guide.sixty.stat_area': { en: '{n} km', pt: '{n} km' },
  'guide.sixty.stat_area_label': { en: 'play radius', pt: 'raio de jogo' },
  'guide.sixty.stat_teams': { en: '2 × 1–4', pt: '2 × 1–4' },
  'guide.sixty.stat_teams_label': { en: 'players', pt: 'jogadores' },

  // -- 2. where you play --
  'guide.where.nav': { en: 'The map', pt: 'O mapa' },
  'guide.where.heading': { en: 'Where you play', pt: 'Onde se joga' },
  'guide.where.body': {
    en: 'Everything happens inside a {radius} m circle centred on Vila Real. Step outside of it and you are out of bounds.',
    pt: 'Tudo acontece dentro de um círculo de {radius} m centrado em Vila Real. Se saíres dele, ficas fora dos limites.',
  },
  'guide.where.pools': {
    en: 'Each team gets a pool of {n} landmarks on its own side of the city and picks {pick} as candidates: {real} for the real flag, {decoy} for decoys and {empty} empty locations.',
    pt: 'Cada equipa recebe um conjunto de {n} locais no seu lado da cidade e escolhe {pick} como candidatos: {real} para a bandeira verdadeira, {decoy} para enganos e {empty} locais vazios.',
  },
  'guide.where.markers': {
    en: 'You place identical physical markers at the real flag and both decoys. The empty spots get nothing — so a marker you find could be either.',
    pt: 'Colocas marcadores físicos idênticos na bandeira verdadeira e nos dois enganos. Os locais vazios não levam nada — por isso um marcador que encontres pode ser qualquer um deles.',
  },
  'guide.where.map_caption': {
    en: 'Team West’s pool. Team East has its own {n} on the far side.',
    pt: 'O conjunto da Equipa Oeste. A Equipa Este tem os seus {n} do outro lado.',
  },
  'guide.where.map_offline': {
    en: 'No map tiles? The dots still show the real spacing.',
    pt: 'Sem mapa de fundo? Os pontos continuam a mostrar as distâncias reais.',
  },
  'guide.where.pool_list': { en: 'See the landmark names', pt: 'Ver os nomes dos locais' },
  'guide.where.pool_west': { en: 'Team West', pt: 'Equipa Oeste' },
  'guide.where.pool_east': { en: 'Team East', pt: 'Equipa Este' },
  'guide.where.home_base': { en: 'home base', pt: 'base' },

  // -- 3. defender or raider --
  'guide.roles.nav': { en: 'Roles', pt: 'Funções' },
  'guide.roles.heading': { en: 'Defender or raider?', pt: 'Defensor ou atacante?' },
  'guide.roles.body': {
    en: 'You are not assigned a role — your feet decide it, second by second. Your team’s defense zone is every point within {radius} m of any of your own candidates, so it is a lumpy blob, not one circle.',
    pt: 'A tua função não é atribuída — são os teus pés que a decidem, a cada segundo. A zona de defesa da tua equipa é tudo o que fica a menos de {radius} m de qualquer um dos teus candidatos, por isso é uma mancha irregular e não um círculo.',
  },
  'guide.roles.defender': {
    en: 'Inside it you are a defender and can tag.',
    pt: 'Dentro dela és defensor e podes capturar.',
  },
  'guide.roles.raider': {
    en: 'Outside it you are a raider and can be tagged.',
    pt: 'Fora dela és atacante e podes ser capturado.',
  },
  'guide.roles.overlap': {
    en: 'The zones overlap in the middle of town. An enemy who comes within {n} m of one of your candidates counts as a raider for you even there — so you can both be defenders of your own ground and raiders on theirs at the same time.',
    pt: 'As zonas sobrepõem-se no centro da cidade. Um adversário que chegue a menos de {n} m de um dos teus candidatos conta como atacante para ti mesmo aí — podes ser, ao mesmo tempo, defensor do teu terreno e atacante no terreno adversário.',
  },
  'guide.roles.diagram_alt': {
    en: 'Three overlapping 200-metre circles around Team West’s candidate landmarks form one lumpy defense zone, with a separate circle for Team East. Numbered pins show a teammate inside the zone, an enemy who has walked into it, and you standing outside it.',
    pt: 'Três círculos de 200 metros sobrepostos em volta dos locais candidatos da Equipa Oeste formam uma zona de defesa irregular, com um círculo separado para a Equipa Este. Pinos numerados mostram um colega dentro da zona, um adversário que entrou nela e tu fora dela.',
  },
  'guide.roles.label_zone': { en: 'Your zone', pt: 'A tua zona' },
  'guide.roles.label_one': {
    en: 'Your teammate, inside your zone — a defender.',
    pt: 'O teu colega, dentro da tua zona — defensor.',
  },
  'guide.roles.label_two': {
    en: 'An enemy who walked in — a raider you can tag.',
    pt: 'Um adversário que entrou — atacante que podes capturar.',
  },
  'guide.roles.label_three': {
    en: 'You, out on neutral ground — a raider yourself.',
    pt: 'Tu, em terreno neutro — também és atacante.',
  },

  // -- 4. tagging --
  'guide.tag.nav': { en: 'Tagging', pt: 'Capturas' },
  'guide.tag.heading': { en: 'Tagging and being tagged', pt: 'Capturar e ser capturado' },
  'guide.tag.body': {
    en: 'Get within {radius} m of an enemy raider while you are inside your own defense zone and the Tag button lights up on its own. There is nothing to type.',
    pt: 'Chega a menos de {radius} m de um atacante adversário enquanto estás dentro da tua zona de defesa e o botão de captura acende sozinho. Não há nada para escrever.',
  },
  'guide.tag.bunching': {
    en: 'One tap catches every raider inside that circle at once — but it only ever costs them {c} coins in total, however many are caught. Bunching up is cheap for raiders. Their intel cards are never taken.',
    pt: 'Um toque apanha todos os atacantes dentro desse círculo ao mesmo tempo — mas só lhes custa {c} moedas no total, independentemente de quantos sejam apanhados. Andar em grupo é barato para os atacantes. As cartas de intel deles nunca são retiradas.',
  },
  'guide.tag.tolerance': {
    en: 'Your phone lights the button at {client} m; the server allows up to {server} m, because two phones in a narrow street rarely agree. The server’s number is the one that counts.',
    pt: 'O teu telemóvel acende o botão aos {client} m; o servidor aceita até {server} m, porque dois telemóveis numa rua estreita raramente concordam. O número do servidor é o que conta.',
  },
  'guide.tag.diagram_alt': {
    en: 'A defender at the centre of a 5-metre circle containing two enemy raiders, and below it the two respawn stages: walk to the assigned neutral landmark, then confirm and walk 45 metres away.',
    pt: 'Um defensor no centro de um círculo de 5 metros com dois atacantes adversários, e abaixo as duas fases de regresso: caminhar até ao local neutro atribuído, confirmar e afastar-se 45 metros.',
  },
  'guide.tag.label_radius': { en: '{n} m', pt: '{n} m' },
  'guide.tag.label_defender': { en: 'You', pt: 'Tu' },
  'guide.tag.label_raiders': { en: 'Both caught in one tap', pt: 'Ambos apanhados num toque' },
  'guide.tag.label_cost': {
    en: 'Their team is fined {c} coins',
    pt: 'A equipa deles é multada em {c} moedas',
  },
  'guide.tag.label_step1': {
    en: 'Walk to the assigned neutral landmark',
    pt: 'Caminha até ao local neutro atribuído',
  },
  'guide.tag.label_step2': {
    en: 'Confirm, then walk {n} m away',
    pt: 'Confirma e afasta-te {n} m',
  },

  // -- 5. camping --
  'guide.camping.nav': { en: 'Camping', pt: 'Acampar' },
  'guide.camping.heading': { en: 'Don’t camp your own flag', pt: 'Não acampes na tua bandeira' },
  'guide.camping.body': {
    en: 'Standing guard on your own flag is the one thing you cannot do. Loiter within {radius} m of any of your own candidates and the app switches off your own Tag button, leaving you next to your flag unable to defend it.',
    pt: 'Ficar de guarda à tua própria bandeira é a única coisa que não podes fazer. Fica a menos de {radius} m de qualquer um dos teus candidatos e a app desliga o teu próprio botão de captura, deixando-te ao lado da bandeira sem a poder defender.',
  },
  'guide.camping.patrol': {
    en: 'Patrol the ring instead: stay in your zone, keep out of the inner circle.',
    pt: 'Patrulha o anel: mantém-te na tua zona, mas fora do círculo interior.',
  },
  'guide.camping.diagram_alt': {
    en: 'A hatched 50-metre no-standing circle around your own candidate landmark, with a timeline marking a warning at 90 seconds and the Tag button switching off at 120 seconds.',
    pt: 'Um círculo tracejado de 50 metros em volta do teu local candidato onde não podes ficar, com uma linha temporal que marca um aviso aos 90 segundos e o botão de captura a desligar aos 120 segundos.',
  },
  'guide.camping.label_radius': { en: '{n} m — don’t linger', pt: '{n} m — não fiques' },
  'guide.camping.label_landmark': { en: 'Your own candidate', pt: 'O teu candidato' },
  'guide.camping.label_warn': { en: '{n} s — the app warns you', pt: '{n} s — a app avisa-te' },
  'guide.camping.label_lock': {
    en: '{n} s — your Tag button switches off',
    pt: '{n} s — o teu botão de captura desliga',
  },
  'guide.camping.label_reset': {
    en: 'Leave for {n} s to reset it',
    pt: 'Afasta-te {n} s para reiniciar',
  },

  // -- 6. attempting a flag --
  'guide.flag.nav': { en: 'Flag attempts', pt: 'Tentativas' },
  'guide.flag.heading': { en: 'Attempting a flag', pt: 'Tentar uma bandeira' },
  'guide.flag.body': {
    en: 'Walk to an enemy candidate, get within about {range} m and tap Attempt. The app reveals a small photo task, you submit a real photo, and the server checks your GPS before telling you what you found.',
    pt: 'Vai até um candidato adversário, chega a cerca de {range} m e toca em Tentar. A app revela uma pequena tarefa fotográfica; envias uma fotografia tirada no local e o servidor verifica o teu GPS antes de te dizer o que encontraste.',
  },
  'guide.flag.protection': {
    en: 'No attempts in the first {n} minutes — use that time to earn coins and buy intel.',
    pt: 'Sem tentativas nos primeiros {n} minutos — aproveita para ganhar moedas e comprar intel.',
  },
  'guide.flag.public_text': {
    en: 'The photo task is public and the same whether or not the flag is there, so reading it tells you nothing. That is also why hardening tightens the GPS radius instead of changing the task — a harder task would give the real flag away.',
    pt: 'A tarefa fotográfica é pública e é igual esteja ou não lá a bandeira, por isso lê-la não te diz nada. É também por isso que reforçar aperta o raio de GPS em vez de mudar a tarefa — uma tarefa mais difícil denunciaria a bandeira verdadeira.',
  },
  'guide.flag.diagram_alt': {
    en: 'One photographed marker branching into three outcomes: the real flag lets you walk home to win, a decoy costs you all your intel plus a 15-minute lockout, and an empty spot only locks the landmark for 15 minutes.',
    pt: 'A fotografia de um marcador pode dar três resultados: com a bandeira verdadeira, regressas à base para ganhar; um engano custa-te toda a informação e bloqueia o local durante 15 minutos; um local vazio apenas fica bloqueado durante 15 minutos.',
  },
  'guide.flag.label_start': { en: 'You photograph a marker', pt: 'Fotografas um marcador' },
  'guide.flag.label_real': { en: 'Real flag', pt: 'Verdadeira' },
  'guide.flag.label_real_body': { en: 'Walk home to win', pt: 'Regressa à base para ganhar' },
  'guide.flag.label_decoy': { en: 'Decoy', pt: 'Engano' },
  'guide.flag.label_decoy_body': {
    en: 'Lose ALL intel',
    pt: 'Perdes TODAS as cartas de intel',
  },
  'guide.flag.label_empty': { en: 'Empty', pt: 'Vazio' },
  'guide.flag.label_empty_body': { en: 'Nothing lost', pt: 'Não perdes nada' },
  'guide.flag.lockout': {
    en: 'A decoy or an empty spot locks that landmark for your team for {n} minutes.',
    pt: 'Um engano ou um local vazio bloqueia esse local para a tua equipa durante {n} minutos.',
  },
  'guide.flag.carrier': {
    en: 'Find the real flag and the app tells everyone immediately — including the team you just robbed. They will come for you on the walk home.',
    pt: 'Se encontrares a bandeira verdadeira, a app avisa todos de imediato — incluindo a equipa cuja bandeira acabaste de roubar. Vão atrás de ti no caminho de volta.',
  },

  // -- 7. coins, intel and curses --
  'guide.economy.nav': { en: 'Coins', pt: 'Moedas' },
  'guide.economy.heading': { en: 'Coins, intel and curses', pt: 'Moedas, intel e maldições' },
  'guide.economy.body': {
    en: 'You start with {start} coins and earn {bonus} more every {interval} minutes just for playing. Challenges are the real income: {min}–{max} coins each, three live at a time, and {first} extra for the first team to finish any of them.',
    pt: 'Começas com {start} moedas e ganhas mais {bonus} a cada {interval} minutos só por jogares. Os desafios são a principal fonte de moedas: {min}–{max} moedas cada, três ativos ao mesmo tempo e mais {first} para a primeira equipa que completar um deles.',
  },
  'guide.economy.review': {
    en: 'Photo challenges go to the other team to check. If they don’t reject it within {n} seconds it passes automatically.',
    pt: 'Os desafios com fotografia vão à outra equipa para verificação. Se não os rejeitarem em {n} segundos, passam automaticamente.',
  },
  'guide.economy.spending': {
    en: 'Coins buy three things: intel to narrow down their flag ({intelMin}–{intelMax}), curse dice to slow them down ({die} each, roll 1–3 at once), and one {harden}-coin hardening of your own real flag.',
    pt: 'As moedas compram três coisas: intel para localizar a bandeira deles ({intelMin}–{intelMax}), dados de maldição para os atrasar ({die} cada, lança 1 a 3 de uma vez), e um reforço da tua própria bandeira por {harden} moedas.',
  },
  'guide.economy.diagram_alt': {
    en: 'Challenges and time bonuses add coins to your balance, which you can spend on intel, curses and hardening your own flag.',
    pt: 'Os desafios e os bónus de tempo acrescentam moedas ao teu saldo, que podes gastar em informação, maldições e no reforço da tua própria bandeira.',
  },
  'guide.economy.label_challenges': { en: 'Challenges', pt: 'Desafios' },
  'guide.economy.label_coins': { en: 'Coins', pt: 'Moedas' },
  'guide.economy.label_passive': {
    en: '+{n} every {interval} min',
    pt: '+{n} a cada {interval} min',
  },
  'guide.economy.label_intel': {
    en: 'Intel — find their flag',
    pt: 'Intel — encontra a bandeira adversária',
  },
  'guide.economy.label_curses': { en: 'Curses — slow them down', pt: 'Maldições — atrasá-los' },
  'guide.economy.label_harden': { en: 'Harden — guard yours', pt: 'Reforço — proteger a tua' },

  'guide.curses.heading': {
    en: 'How curses are enforced',
    pt: 'Como as maldições são fiscalizadas',
  },
  'guide.curses.body': {
    en: 'Roll one to three dice. The total sets the tier: 1–3 minor, 4–8 medium, 9 or more major. Curses never stack on the same effect.',
    pt: 'Lança um a três dados. O total define o nível: 1–3 ligeiro, 4–8 médio, 9 ou mais grave. As maldições com o mesmo efeito nunca se acumulam.',
  },
  'guide.curses.legend_intro': {
    en: 'Each curse is tagged with how the app checks it:',
    pt: 'Cada maldição indica como a app a verifica:',
  },
  'guide.curses.legend_a': {
    en: 'GPS-assisted — the app shows live position or speed readouts.',
    pt: 'Apoiada por GPS — a app mostra leituras de posição ou velocidade.',
  },
  'guide.curses.legend_b': {
    en: 'Photo-verified — the app asks for a proof photo within a time window.',
    pt: 'Verificada por fotografia — a app pede uma fotografia de prova dentro de um prazo.',
  },
  'guide.curses.legend_c': {
    en: 'Honour system — the app reminds you, nothing checks you.',
    pt: 'Baseada na confiança — a app lembra-te, mas não faz qualquer verificação.',
  },
  'guide.curses.legend_l': {
    en: 'Ledger only — pure app effect on coins, intel or your buttons.',
    pt: 'Apenas registo — efeito da app nas moedas, na informação ou nos teus botões.',
  },
  'guide.curses.placed': {
    en: 'Placed curses are different: you arm one at a landmark and it waits, hidden, for an enemy to walk in. They cannot see it coming.',
    pt: 'As maldições colocadas são diferentes: armas uma num local e ela fica escondida à espera que um adversário entre. O adversário não sabe que lá está.',
  },
  'guide.curses.team_size': {
    en: 'In a 1v1 game, curses and challenges that need a teammate are left out.',
    pt: 'Num jogo 1 contra 1, as maldições e os desafios que exigem um colega ficam de fora.',
  },

  // -- 8. reading intel --
  'guide.intel.nav': { en: 'Intel', pt: 'Intel' },
  'guide.intel.heading': { en: 'Reading intel', pt: 'Interpretar as cartas de intel' },
  'guide.intel.body': {
    en: 'Intel does not point at the flag — it crosses candidates off. Your team may hold at most {cap} cards at a time. If an enemy action destroys one, the slot reopens, but you can never buy the same card twice.',
    pt: 'A informação não aponta para a bandeira — elimina candidatos. A tua equipa pode ter, no máximo, {cap} cartas ao mesmo tempo. Se uma ação adversária destruir uma delas, o espaço fica livre, mas nunca podes voltar a comprar a mesma carta.',
  },
  'guide.intel.sequence': {
    en: 'Sequence matters. A north/south split halves five candidates to two or three; an eliminate card then takes one of those away. Buying two cards that rule out the same ground wastes one.',
    pt: 'A ordem importa. Uma divisão norte/sul reduz cinco candidatos a dois ou três; uma carta de eliminação tira depois um deles. Comprar duas cartas que excluem o mesmo terreno desperdiça uma.',
  },
  // 0058: a tag no longer takes a card — it fines {c} coins. The decoy wipe is
  // unchanged and is now the ONLY thing that costs you intel, which is the point
  // of the warning.
  'guide.intel.loss': {
    en: 'Getting tagged never takes a card — it fines your team {c} coins. Photographing a decoy is the one thing that costs you intel: every card you own, which is why a guess is never free.',
    pt: 'Ser capturado nunca te tira uma carta — multa a tua equipa em {c} moedas. Fotografar um engano é a única coisa que te custa cartas de intel: perdes todas as que tens, por isso adivinhar nunca é grátis.',
  },
  'guide.intel.diagram_alt': {
    en: 'Five candidate markers, then a purchased north/south card, then the same five with two struck out and three still live.',
    pt: 'Cinco locais candidatos, depois uma carta norte/sul comprada e os mesmos cinco com dois riscados e três ainda em jogo.',
  },
  'guide.intel.label_before': {
    en: 'Five candidates, any could hold it',
    pt: 'Cinco candidatos, pode ser qualquer um',
  },
  'guide.intel.label_card': { en: 'Buy one intel card', pt: 'Compra uma carta de intel' },
  'guide.intel.label_after': {
    en: 'Two ruled out — three left to walk',
    pt: 'Dois excluídos — faltam três',
  },
  'guide.intel.label_ruled_out': { en: 'Ruled out', pt: 'Excluídos' },

  // -- 9. how to lose by accident --
  'guide.mistakes.nav': { en: 'Common mistakes', pt: 'Erros comuns' },
  'guide.mistakes.heading': { en: 'How to lose by accident', pt: 'Como perder sem querer' },
  'guide.mistakes.decoy': {
    en: 'Photographing a decoy on a hunch. It wipes every intel card your team holds. The empty slots can be filled with different cards, but you can never buy the same cards again.',
    pt: 'Fotografar um engano por palpite. Apaga todas as cartas de informação que a tua equipa tem. Podes preencher os espaços vazios com cartas diferentes, mas nunca voltar a comprar as mesmas.',
  },
  'guide.mistakes.camping': {
    en: 'Guarding your own flag too closely. Past {n} seconds inside the inner circle your own Tag button stops working.',
    pt: 'Guardar a tua bandeira demasiado de perto. Passados {n} segundos dentro do círculo interior, o teu botão de captura deixa de funcionar.',
  },
  'guide.mistakes.bounds': {
    en: 'Drifting outside the play circle. Watch the edge on the map.',
    pt: 'Sair do círculo de jogo sem dar conta. Atenção ao limite no mapa.',
  },
  'guide.mistakes.clock': {
    en: 'Forgetting the walk. Crossing town between the two home bases takes roughly 15 minutes each way — a flag you find late may not make it home.',
    pt: 'Esquecer a caminhada. Atravessar a cidade entre as duas bases leva cerca de 15 minutos em cada sentido — uma bandeira encontrada tarde pode não chegar a casa.',
  },
  'guide.mistakes.radar': {
    en: 'Thinking the enemy radar is broken. It pulses on and off on purpose, and only ever shows enemies standing inside your own defense zones.',
    pt: 'Achar que o radar dos adversários está avariado. Ele pisca de propósito e só mostra adversários que estejam dentro das tuas zonas de defesa.',
  },

  // -- 10. endgame --
  'guide.endgame.nav': { en: 'Winning', pt: 'Ganhar' },
  'guide.endgame.heading': { en: 'Winning and the clock', pt: 'Ganhar e o relógio' },
  'guide.endgame.body': {
    en: 'A game ends the moment a flag carrier crosses into their own home base — or when the {n}-minute clock runs out.',
    pt: 'O jogo acaba no momento em que quem leva a bandeira entra na sua própria base — ou quando os {n} minutos terminam.',
  },
  'guide.endgame.points': {
    en: 'If the clock wins, points decide: {flag} for photographing the enemy’s real flag, {challenge} per challenge completed, {tag} per successful tag. Curse casts and leftover coins score nothing.',
    pt: 'Se o relógio ganhar, decidem os pontos: {flag} por fotografar a bandeira verdadeira do adversário, {challenge} por desafio concluído, {tag} por captura bem-sucedida. As maldições lançadas e as moedas que sobram não valem pontos.',
  },
  'guide.endgame.tiebreak': {
    en: 'Still tied? Most challenges, then most coins, then a coin flip.',
    pt: 'Continua empatado? Mais desafios, depois mais moedas e, por fim, um lançamento de moeda ao ar.',
  },
  'guide.endgame.weather': {
    en: 'If the weather turns, either team can propose a pause; the other has {n} minutes to confirm. Resuming needs both teams too.',
    pt: 'Se o tempo piorar, qualquer equipa pode propor uma pausa; a outra tem {n} minutos para confirmar. Retomar também exige as duas equipas.',
  },
  'guide.endgame.diagram_alt': {
    en: 'The four phases of a game as a numbered timeline: lobby, setup, the three-hour hunt, and winning either by carrying the flag home or on points.',
    pt: 'As quatro fases de um jogo numa linha temporal numerada: sala de espera, preparação, as três horas de caça, e a vitória por levar a bandeira a casa ou por pontos.',
  },
  'guide.endgame.label_lobby': { en: 'Lobby', pt: 'Sala de espera' },
  'guide.endgame.label_lobby_body': {
    en: 'Pick a side, then ready up',
    pt: 'Escolhe um lado e fica pronto',
  },
  'guide.endgame.label_setup': { en: 'Setup', pt: 'Preparação' },
  'guide.endgame.label_setup_body': {
    en: 'Hide your flag among five candidates',
    pt: 'Esconde a bandeira entre cinco candidatos',
  },
  'guide.endgame.label_hunt': { en: 'The hunt', pt: 'A caça' },
  'guide.endgame.label_hunt_body': {
    en: 'Earn, curse, raid and tag',
    pt: 'Ganha, amaldiçoa, ataca e captura',
  },
  'guide.endgame.label_end': { en: 'Win', pt: 'Vitória' },
  'guide.endgame.label_end_body': {
    en: 'Carry the photo home, or win on points',
    pt: 'Leva a fotografia até à base ou ganha por pontos',
  },
  'guide.endgame.label_protection': {
    en: 'No flag attempts for the first {n} min',
    pt: 'Sem tentativas nos primeiros {n} min',
  },
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
