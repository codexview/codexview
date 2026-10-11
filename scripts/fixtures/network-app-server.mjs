// Controlled protocol peer, NOT Codex or a managed network proxy. No network or model calls.
import { createInterface } from 'node:readline';
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const threadId = 'controlled-network-thread';
const requestId = 'network-approval:7';
let turn;
let item;
let pending = false;
const thread = () => ({ id: threadId, turns: turn ? [turn] : [], status: { type: pending ? 'active' : 'idle' } });
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const result = value => write({ id: message.id, result: value });
  const notify = (method, params) => write({ method, params });
  if (!message.method) {
    if (message.id !== requestId || !pending) throw Error('Unexpected or duplicate approval response');
    if (!['accept', 'decline'].includes(message.result?.decision)) throw Error('Unexpected decision');
    pending = false;
    notify('serverRequest/resolved', { threadId, requestId });
    item = { ...item, status: message.result.decision === 'accept' ? 'completed' : 'declined', exitCode: message.result.decision === 'accept' ? 0 : null };
    notify('item/completed', { threadId, turnId: turn.id, item });
    turn = { ...turn, status: 'completed', items: [item] };
    notify('turn/completed', { threadId, turn });
    continue;
  }
  switch (message.method) {
    case 'initialize': result({ userAgent: 'controlled-network-protocol-peer' }); break;
    case 'initialized': break;
    case 'model/list': result({ data: [], nextCursor: null }); break;
    case 'thread/start':
    case 'thread/resume':
    case 'thread/read': result({ thread: thread() }); break;
    case 'thread/turns/list': result({ data: turn ? [turn] : [], nextCursor: null }); break;
    case 'turn/start': {
      if (pending) throw Error('Turn already active');
      const scenario = message.params.input[0].text;
      const second = scenario === 'decline-after-restart';
      turn = { id: scenario, status: 'inProgress', items: [], error: null };
      item = { type: 'commandExecution', id: 'network-item', command: '', cwd: '/synthetic', status: 'inProgress', aggregatedOutput: '', exitCode: null };
      pending = true;
      result({ turn });
      notify('turn/started', { threadId, turn });
      notify('item/started', { threadId, turnId: turn.id, item });
      write({ id: requestId, method: 'item/commandExecution/requestApproval', params: {
        threadId, turnId: turn.id, itemId: item.id,
        networkApprovalContext: { host: second ? 'decline.synthetic.invalid' : 'accept.synthetic.invalid', protocol: second ? 'socks5Tcp' : 'https' },
      } });
      break;
    }
    default: write({ id: message.id, error: { code: -32601, message: 'Unsupported controlled peer method: ' + message.method } });
  }
}
