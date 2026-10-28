import { CodexRuntime, type RuntimeOptions } from '@codexview/runtime';
import { AppServerTranscriptStore, type ChatStreamEvent, type SessionTransport, type SessionSnapshot } from '@codexview/adapters';
import { CodexTranscript, CodexSession, VERSION } from '@codexview/react';
import { createElement } from 'react';

const options: RuntimeOptions = { maxTurns: 10 };
const runtime = new CodexRuntime(options);
const events: ChatStreamEvent[] = new AppServerTranscriptStore('test').getEvents();
createElement(CodexTranscript, { events });
declare const transport: SessionTransport;
createElement(CodexSession, { threadId: 'test', transport });
const version: string = VERSION;
const snapshot: SessionSnapshot = runtime.getSnapshot('test');
void version;
void snapshot;
