import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionConnection, SessionSnapshot, SessionTransport } from '@codexview/adapters';
import { CodexSession } from './CodexSession.js';

function fixture() {
  let listener: (snapshot: SessionSnapshot) => void = () => {};
  let connection: (state: SessionConnection) => void = () => {};
  const transport: SessionTransport = {
    subscribe: vi.fn((_threadId, next, onConnection) => { listener = next; connection = onConnection ?? (() => {}); return vi.fn(); }),
    send: vi.fn(async () => ({})), steer: vi.fn(async () => ({})), interrupt: vi.fn(async () => ({})), reply: vi.fn(async () => ({})),
    models: vi.fn(async () => [{ id: 'model-id', model: 'model', displayName: 'Test model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'More reasoning' }] }]),
  };
  let revision = 0;
  return { transport, emit: (next: Partial<SessionSnapshot>) => act(() => listener({ threadId: 'thread', epoch: 'test-epoch', revision: ++revision, connection: 'connected', execution: 'idle', events: [], requests: [], ...next })), disconnect: () => act(() => connection('disconnected')) };
}

describe('CodexSession', () => {
  it('sends options, steers the expected turn and interrupts it', async () => {
    const host = fixture(); render(<CodexSession threadId="thread" transport={host.transport} />); host.emit({});
    await screen.findByRole('option', { name: 'Test model' });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model' } });
    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Start work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(host.transport.send).toHaveBeenCalledWith('thread', 'Start work', { model: 'model', effort: 'high' }));
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
    host.emit({ execution: 'running', activeTurnId: 'turn' });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Adjust work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }));
    await waitFor(() => expect(host.transport.steer).toHaveBeenCalledWith('thread', 'Adjust work', 'turn'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(host.transport.interrupt).toHaveBeenCalledWith('thread', 'turn'));
  });

  it('keeps execution on disconnect and exposes compaction', () => {
    const host = fixture(); render(<CodexSession threadId="thread" transport={host.transport} />);
    host.emit({ execution: 'running', activeTurnId: 'turn' }); host.disconnect();
    expect(screen.getByText(/Connection: disconnected · Execution: running/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    host.emit({ execution: 'compacting', activeTurnId: 'turn' });
    expect(screen.getByText('Compacting context…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Steer' })).toBeDisabled();
  });

  it('preserves original approval IDs, waits for an explicit decision and disables duplicate replies', async () => {
    const host = fixture(); render(<CodexSession threadId="thread" transport={host.transport} />);
    host.emit({ execution: 'waitingApproval', requests: [{ id: 17, method: 'item/fileChange/requestApproval', threadId: 'thread', params: { reason: 'Edit file' } }] });
    expect(host.transport.reply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await waitFor(() => expect(host.transport.reply).toHaveBeenCalledWith('thread', 17, { decision: 'accept' }, 'test-epoch'));
    await screen.findByText('Response sent');
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
  });

  it.each([
    ['https', 'Approve', 'accept'],
    ['http', 'Decline', 'decline'],
    ['socks5Tcp', 'Cancel turn', 'cancel'],
    ['socks5Udp', 'Approve', 'accept'],
  ])('shows a context-only %s network approval and preserves reply identity', async (protocol, button, decision) => {
    const host = fixture(); render(<CodexSession threadId="thread" transport={host.transport} />);
    // Stable codex-cli 0.162.1 shape: command/reason/cwd are optional;
    // NetworkApprovalContext has host and protocol, with no port field.
    host.emit({ epoch: 'network-epoch', execution: 'waitingApproval', requests: [{
      id: 'network-request', method: 'item/commandExecution/requestApproval', threadId: 'thread', turnId: 'turn',
      params: { kind: 'command', threadId: 'thread', turnId: 'turn', itemId: 'network-item', startedAtMs: 0, environmentId: null,
        networkApprovalContext: { host: 'api.example.test', protocol } },
    }] });
    const card = screen.getByRole('region', { name: 'Request network-request' });
    expect(card).toHaveTextContent(`Requested network access: api.example.test (protocol: ${protocol})`);
    expect(card).toHaveTextContent('Transcript item: network-item');
    expect(host.transport.reply).not.toHaveBeenCalled();
    for (const name of ['Approve', 'Decline', 'Cancel turn']) expect(screen.getByRole('button', { name })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(host.transport.reply).toHaveBeenCalledWith('thread', 'network-request', { decision }, 'network-epoch'));
    await screen.findByText('Response sent');
    expect(host.transport.reply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: button })).toBeDisabled();
  });

  it('replies to multiple questions by question IDs', async () => {
    const host = fixture(); render(<CodexSession threadId="thread" transport={host.transport} />);
    host.emit({ execution: 'waitingInput', requests: [{ id: 'request-id', method: 'item/tool/requestUserInput', threadId: 'thread', params: { questions: [
      { id: 'color', question: 'Choose color', options: [{ label: 'Blue' }] },
      { id: 'note', question: 'Add note', options: null },
    ] } }] });
    fireEvent.change(screen.getByLabelText('Choose color'), { target: { value: 'Blue' } });
    fireEvent.change(screen.getByLabelText('Add note'), { target: { value: 'Ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    await waitFor(() => expect(host.transport.reply).toHaveBeenCalledWith('thread', 'request-id', { answers: { color: { answers: ['Blue'] }, note: { answers: ['Ready'] } } }, 'test-epoch'));
  });
});

it('shows the actual file path and diff before approving a file change', async () => {
  const host = fixture(); render(<CodexSession threadId="thread" transport={host.transport} />);
  host.emit({ execution: 'waitingApproval', events: [
    { type: 'turn_started', turnId: 'turn', at: 0 },
    { type: 'patch_apply_begin', turnId: 'turn', callId: 'patch', at: 0, files: [{ path: 'accept.txt', status: 'added', diff: 'FILE_ACCEPT' }] },
  ], requests: [{ id: 2, threadId: 'thread', turnId: 'turn', method: 'item/fileChange/requestApproval', params: { itemId: 'patch', reason: null, grantRoot: null } }] });
  const card = screen.getByRole('region', { name: 'Request 2' });
  expect(card).toHaveTextContent('accept.txt'); expect(card).toHaveTextContent('FILE_ACCEPT');
  expect(screen.queryByText(/未知事件/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(host.transport.reply).toHaveBeenCalledWith('thread', 2, { decision: 'accept' }, 'test-epoch'));
});
