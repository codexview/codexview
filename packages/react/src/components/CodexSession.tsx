import { useState, type FormEvent } from 'react';
import type { SessionRequest, SessionTransport } from '@codexview/adapters';
import { useCodexSession, sessionRequestKey, type CodexSessionController } from '../hooks/useCodexSession.js';
import { CodexTranscript, type CodexTranscriptProps } from './CodexTranscript.js';
import type { TranscriptStatus } from '../types/model.js';
import styles from './CodexSession.module.css';

export interface CodexSessionProps {
  threadId: string;
  transport: SessionTransport;
  readOnly?: boolean;
  className?: string;
  transcriptProps?: Omit<CodexTranscriptProps, 'events' | 'status'>;
}
const ignoreFailure = (promise: Promise<unknown>) => { void promise.catch(() => {}); };
const statusFor = (execution: string): TranscriptStatus => {
  switch (execution) {
    case 'running': case 'compacting': case 'waitingApproval': case 'waitingInput': return 'working';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'interrupted': return 'stopped';
    default: return 'idle';
  }
};

export function CodexSession({ threadId, transport, readOnly = false, className, transcriptProps }: CodexSessionProps) {
  const session = useCodexSession({ threadId, transport });
  return <section className={[styles.root, className].filter(Boolean).join(' ')} aria-label="Codex session">
    <div className={styles.sessionState} aria-live="polite">Connection: {session.snapshot.connection} · Execution: {session.snapshot.execution}</div>
    {session.snapshot.execution === 'compacting' && <p role="status">Compacting context…</p>}
    {session.snapshot.truncated && <p>Older completed turns are omitted. Load history through your host application.</p>}
    <CodexTranscript {...transcriptProps} events={session.snapshot.events} status={statusFor(session.snapshot.execution)} />
    <SessionRequests session={session} readOnly={readOnly} />
    {!readOnly && <SessionComposer key={threadId} session={session} />}
    {(session.actionError || session.snapshot.error) && <p role="alert">{session.actionError || session.snapshot.error}</p>}
  </section>;
}

export interface SessionComposerProps { session: CodexSessionController }
export function SessionComposer({ session }: SessionComposerProps) {
  const [text, setText] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const catalogModel = session.models.find(entry => entry.model === model);
  const activeTurnId = session.snapshot.activeTurnId;
  const active = !!activeTurnId && ['running', 'waitingApproval', 'waitingInput', 'compacting', 'unknown'].includes(session.snapshot.execution);
  const disabled = session.busy || session.snapshot.connection !== 'connected';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !text.trim()) return;
    const promise = active && activeTurnId ? session.steer(text, activeTurnId) : session.send(text, { ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
    void promise.then(() => setText('')).catch(() => {});
  };
  return <form className={styles.composer} onSubmit={submit} aria-label="Session composer">
    <label>Model<select aria-label="Model" value={model} disabled={disabled || active} onChange={event => { setModel(event.target.value); setEffort(''); }}>
      <option value="">Server default</option>{session.models.map(entry => <option key={entry.id} value={entry.model}>{entry.displayName}</option>)}
    </select></label>
    <label>Reasoning effort<select aria-label="Reasoning effort" value={effort} disabled={disabled || active || !catalogModel} onChange={event => setEffort(event.target.value)}>
      <option value="">{catalogModel ? `Default (${catalogModel.defaultReasoningEffort})` : 'Server default'}</option>
      {catalogModel?.supportedReasoningEfforts.map(entry => <option key={entry.reasoningEffort} value={entry.reasoningEffort}>{entry.reasoningEffort}</option>)}
    </select></label>
    <small className={styles.catalogNote}>Model catalog availability does not confirm account entitlement.</small>
    <label className={styles.message}>Message<textarea aria-label="Message" value={text} onChange={event => setText(event.target.value)} disabled={disabled} /></label>
    <button type="submit" disabled={disabled || !text.trim() || session.snapshot.execution === 'compacting'}>{active ? 'Steer' : 'Send'}</button>
    {active && <button type="button" disabled={disabled} onClick={() => ignoreFailure(session.interrupt())}>Stop</button>}
  </form>;
}

export interface SessionRequestsProps { session: CodexSessionController; readOnly?: boolean }
export function SessionRequests({ session, readOnly = false }: SessionRequestsProps) {
  return <div className={styles.requests} aria-label="Session requests">{session.snapshot.requests.map(request => {
    const key = sessionRequestKey(request.id);
    const resolved = session.resolvedRequestIds.has(key);
    const disabled = readOnly || session.snapshot.connection !== 'connected' || resolved || session.pendingRequestIds.has(key);
    return <RequestCard key={`${session.snapshot.epoch ?? "legacy"}:${key}`} request={request} disabled={disabled} resolved={resolved} reply={session.reply} />;
  })}</div>;
}
interface Question { id: string; header?: string; question: string; isOther?: boolean; isSecret?: boolean; options?: { label: string; description?: string }[] | null }
function RequestCard({ request, disabled, resolved, reply }: { request: SessionRequest; disabled: boolean; resolved: boolean; reply: CodexSessionController['reply'] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const approval = request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval';
  const userInput = request.method === 'item/tool/requestUserInput';
  const questions = userInput && Array.isArray(request.params.questions) ? request.params.questions as Question[] : [];
  return <section className={styles.request} aria-label={`Request ${request.id}`}>
    <h3>{approval ? 'Approval required' : userInput ? 'Input requested' : 'Unsupported request'}</h3>
    {resolved && <p>Response sent</p>}
    {approval && <>
      {typeof request.params.reason === 'string' && <p>{request.params.reason}</p>}
      {typeof request.params.command === 'string' && <pre>{request.params.command}</pre>}
      {typeof request.params.cwd === 'string' && <p>Directory: {request.params.cwd}</p>}
      {typeof request.params.itemId === 'string' && <p>Transcript item: {request.params.itemId}</p>}
      {typeof request.params.grantRoot === 'string' && <p>Requested write root: {request.params.grantRoot}</p>}
      {['accept', 'decline', 'cancel'].map(decision => <button key={decision} type="button" disabled={disabled} onClick={() => ignoreFailure(reply(request.id, { decision }))}>{decision === 'accept' ? 'Approve' : decision === 'decline' ? 'Decline' : 'Cancel turn'}</button>)}
    </>}
    {userInput && <form onSubmit={event => { event.preventDefault(); if (!disabled) ignoreFailure(reply(request.id, { answers: Object.fromEntries(questions.map(question => [question.id, { answers: [answers[question.id] ?? ''] }])) })); }}>
      {questions.map(question => <fieldset key={question.id} disabled={disabled}>
        <legend>{question.header || question.id}</legend><label>{question.question}
          {question.options?.length && !question.isOther ? <select aria-label={question.question} value={answers[question.id] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))}>
            <option value="">Choose an answer</option>{question.options.map(option => <option key={option.label} value={option.label}>{option.label}{option.description ? ` — ${option.description}` : ''}</option>)}
          </select> : <input aria-label={question.question} type={question.isSecret ? 'password' : 'text'} list={question.options?.length ? `${sessionRequestKey(request.id)}-${question.id}` : undefined} value={answers[question.id] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} />}
        </label>
        {question.isOther && question.options?.length ? <datalist id={`${sessionRequestKey(request.id)}-${question.id}`}>{question.options.map(option => <option key={option.label} value={option.label} />)}</datalist> : null}
      </fieldset>)}
      <button disabled={disabled || questions.length === 0 || questions.some(question => !answers[question.id]?.trim())}>Submit answers</button>
    </form>}
    {!approval && !userInput && <p>{request.method} requires a host-provided handler.</p>}
  </section>;
}
