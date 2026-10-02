import { visualState } from './client-state.js';
export function renderRoom(agents, connection) {
  const section = document.createElement('section'); section.className = 'room-panel';
  const heading = document.createElement('h2'); heading.textContent = 'Operations room'; section.append(heading);
  const caption = document.createElement('p'); caption.className = 'muted'; caption.textContent = 'A visual projection of your workforce · activity follows saved job and tool state'; section.append(caption);
  const room = document.createElement('div'); room.className = 'room'; room.setAttribute('aria-label', 'Authoritative agent activity');
  agents.forEach((agent, index) => {
    const state = visualState(agent, connection), station = document.createElement('div'); station.className = `station state-${state}`;
    const number = document.createElement('span'); number.className = 'station-number'; number.textContent = `STATION ${String(index + 1).padStart(2, '0')}`;
    const desk = document.createElement('img'); desk.src = '/assets/workstation.svg'; desk.alt = ''; desk.className = 'desk';
    const character = document.createElement('img'); character.src = '/assets/agent.svg'; character.alt = ''; character.className = 'character';
    const name = document.createElement('strong'); name.textContent = agent.name;
    const status = document.createElement('span'); status.className = 'station-status'; status.textContent = state.replaceAll('-', ' ');
    const signal = document.createElement('span'); signal.className = 'work-signal'; signal.setAttribute('aria-hidden', 'true'); signal.textContent = state === 'waiting-for-approval' ? '?' : state === 'tool-use' ? '↗' : state === 'completed' ? '✓' : state === 'failed' ? '!' : '•';
    station.append(number, desk, character, signal, name, status); room.append(station);
  });
  if (!agents.length) { const empty = document.createElement('p'); empty.textContent = 'No agents in this business.'; room.append(empty); }
  section.append(room); return section;
}
