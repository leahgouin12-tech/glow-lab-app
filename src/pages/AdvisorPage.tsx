import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpenCheck, MessageSquarePlus, Send, Sparkles, Trash2 } from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { formatDate, newId, softDelete, todayISO } from '../db/repo';
import { saveRow, useRows, useRowsState } from '../hooks/live';
import { loadSettings, updateSettings, type AppSettings } from '../state/settings';
import { advise, type AdvisorReply } from '../engine/advisor';
import { buildContext, syncRecommendations } from '../engine/recommendations';
import { Button, Card, Chip, Disclosure, EmptyState, Section, TextArea, useToast } from '../ui/primitives';
import { DeptIntro } from '../ui/editorial';
import '../styles/departments/advisor.css';

const OPENERS = [
  'What should I do today?',
  'Is this worth buying?',
  'How is my hair progress?',
  'Why was this prioritised?',
  'What should I not do?'
];

/**
 * Central Glow Advisor (spec Part 26). A deterministic rule engine over the
 * user's own records — every reply is stamped with the engine that produced it,
 * because implying a model answered would be a lie.
 */
export default function AdvisorPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [conversations, conversationsLoaded] = useRowsState(TABLES.conversations);
  const allMessages = useRows(TABLES.messages);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeId, setActiveId] = useState<string>(params.get('id') ?? '');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastReply, setLastReply] = useState<AdvisorReply | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const messages = useMemo(
    () => allMessages.filter((m) => m.conversationId === activeId).sort((a, b) => a.createdAt - b.createdAt),
    [allMessages, activeId]
  );

  useEffect(() => {
    if (!conversationsLoaded) return;
    if (conversations.length) {
      if (!activeId || !conversations.some((c) => c.id === activeId)) setActiveId(conversations[0].id);
      return;
    }
    // Opening one conversation is enough for the visit: the write is async, so
    // re-running this per render would leave a stack of empty ones behind.
    if (autoOpened.current) return;
    autoOpened.current = true;
    void startConversation();
  }, [conversations, conversationsLoaded, activeId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: settings?.reducedMotion ? 'auto' : 'smooth' });
  }, [messages.length, settings?.reducedMotion]);

  const startConversation = async () => {
    const id = newId('cnv');
    await saveRow(TABLES.conversations, {
      id,
      advisor: 'glow-advisor',
      title: 'New conversation',
      startedOn: todayISO(),
      contextScopes: ['goals', 'routines', 'purchases', 'progress']
    } as never);
    setActiveId(id);
    setParams({ id });
    return id;
  };

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || !settings) return;
      setBusy(true);
      // Asking is never a dead end: with no conversation open, this question opens one.
      const convId = activeId || (await startConversation());
      const conv = conversations.find((c) => c.id === convId);
      await saveRow(TABLES.messages, {
        conversationId: convId,
        role: 'user',
        body: q,
        on: todayISO(),
        engine: 'local-rules',
        citations: [],
        pendingActions: []
      } as never);
      if (conv && conv.title === 'New conversation') {
        await saveRow(TABLES.conversations, { ...conv, title: q.slice(0, 62) } as never);
      }
      try {
        const ctx = await buildContext();
        const reply = await advise(q, ctx, settings);
        await saveRow(TABLES.messages, {
          conversationId: convId,
          role: 'advisor',
          body: reply.body,
          on: todayISO(),
          engine: reply.engine,
          citations: reply.citations,
          pendingActions: reply.pendingActions,
          chips: reply.chips,
          intent: reply.intent,
          confidence: reply.confidence
        } as never);
        setLastReply(reply);
      } catch (err) {
        await saveRow(TABLES.messages, {
          conversationId: convId,
          role: 'system',
          body: 'The rules engine could not read your records for that question, so nothing was answered. Your data is intact — reload the page and try again.',
          on: todayISO(),
          engine: 'local-rules',
          citations: [],
          pendingActions: []
        } as never);
        toast('That question failed to compute.', 'bad');
        void err;
      } finally {
        setDraft('');
        setBusy(false);
      }
    },
    [activeId, conversations, settings, toast]
  );

  const acceptAction = async (msg: AnyRow, actionId: string) => {
    const actions = ((msg.pendingActions as AdvisorReply['pendingActions']) ?? []).map((a) =>
      a.id === actionId ? { ...a, accepted: true } : a
    );
    const action = actions.find((a) => a.id === actionId);
    await saveRow(TABLES.messages, { ...msg, pendingActions: actions } as never);
    if (!action) return;
    const table = Object.values(TABLES).includes(action.table as never) ? (action.table as keyof typeof TABLES) : TABLES.recommendations;
    if (table === TABLES.recommendations) {
      await syncRecommendations(await buildContext());
      toast('Recommendations refreshed from your records.', 'ok');
      return;
    }
    await saveRow(table, { ...(action.payload as object), id: newId('act') } as never);
    toast('Created in your records.', 'ok');
  };

  const setBluntness = (v: AppSettings['advisorBluntness']) => {
    setSettings((s) => (s ? { ...s, advisorBluntness: v } : s));
    void updateSettings({ advisorBluntness: v });
  };

  return (
    <>
      <DeptIntro
        id="advisor"
        deck="Ask about your own records. The answers come from readable rules over what you logged plus the evidence library — never from a model, and never from a photo."
        meta={[
          { label: 'Engine', value: settings?.advisorEngine === 'local+provider' ? 'Local rules (provider not called)' : 'Local rules' },
          { label: 'Tone', value: settings?.advisorBluntness ?? 'balanced' },
          { label: 'Conversations', value: String(conversations.length) }
        ]}
        actions={
          <Button variant="gold" icon={<MessageSquarePlus size={15} />} onClick={() => void startConversation()}>
            New conversation
          </Button>
        }
      />

      <div className="gl-advisor">
        <aside className="gl-advisor__side">
          <div className="gl-eyebrow">Conversations</div>
          <div className="gl-list">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                className="gl-list__row gl-list__row--button"
                data-on={c.id === activeId}
                onClick={() => {
                  setActiveId(c.id);
                  setParams({ id: c.id });
                }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="gl-strong" style={{ display: 'block' }}>
                    {c.title}
                  </span>
                  <span className="gl-tech gl-faint" style={{ fontSize: '0.62rem' }}>
                    {formatDate(c.startedOn)} · {allMessages.filter((m) => m.conversationId === c.id).length} messages
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="gl-stack" style={{ gap: 10 }}>
            <div className="gl-eyebrow">How direct?</div>
            <div className="gl-row gl-row--tight">
              {(['gentle', 'balanced', 'technical'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  className="gl-chip gl-chip--clickable"
                  data-on={settings?.advisorBluntness === b}
                  aria-pressed={settings?.advisorBluntness === b}
                  onClick={() => setBluntness(b)}
                >
                  {b}
                </button>
              ))}
            </div>
            <p className="gl-small gl-faint">
              Tone changes phrasing only. Safety refusals and evidence grades never soften.
            </p>
          </div>

          {activeId ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={() => {
                if (!window.confirm('Delete this conversation? Your other records are untouched.')) return;
                const conv = conversations.find((c) => c.id === activeId);
                if (conv) void softDelete(TABLES.conversations, conv.id);
                for (const m of messages) void softDelete(TABLES.messages, m.id);
                setActiveId('');
                toast('Conversation removed.', 'ok');
              }}
            >
              Delete conversation
            </Button>
          ) : null}
        </aside>

        <section className="gl-advisor__main">
          <div className="gl-chat" ref={scroller}>
            {messages.length === 0 ? (
              <EmptyState
                title="Ask something specific"
                body="The advisor reads your goals, routines, logs, purchases, assessments and evidence library. It will tell you when it has no data rather than guess."
                icon={<Sparkles size={20} />}
              />
            ) : null}
            {messages.map((m) => (
              <Message
                key={m.id}
                msg={m}
                onChip={(c) => void ask(c)}
                onAccept={(actionId) => void acceptAction(m, actionId)}
              />
            ))}
            {busy ? <div className="gl-msg gl-msg--system">Reading your records…</div> : null}
          </div>

          <form
            className="gl-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <TextArea
              value={draft}
              onChange={setDraft}
              rows={2}
              placeholder="e.g. I have £60 — sunscreen, a retinoid or a brow lamination?"
            />
            <Button type="submit" variant="primary" icon={<Send size={15} />} disabled={busy || !draft.trim()}>
              Ask
            </Button>
          </form>

          <div className="gl-row gl-row--tight" role="group" aria-label="Ready-made questions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            {OPENERS.map((o) => (
              <button
                key={o}
                type="button"
                className="gl-chip gl-chip--clickable"
                aria-label={`Ask: ${o}`}
                onClick={() => void ask(o)}
                disabled={busy}
              >
                {o}
              </button>
            ))}
          </div>

          {lastReply?.confidence === 'no-data' ? (
            <Card className="gl-advisor__note" accent>
              <span className="gl-small">
                The last answer had no data behind it. Anything the advisor could not ground in your records is stated as such.
              </span>
            </Card>
          ) : null}
        </section>
      </div>

      <Section eyebrow="Boundaries" title="What the advisor will not do">
        <div className="gl-grid gl-grid--2">
          <Card>
            <div className="gl-strong" style={{ marginBottom: 6 }}>No scores</div>
            <p className="gl-small gl-muted">
              Requests for an attractiveness rating, a “looksmaxx score” or a percentile are refused. There is no validated
              instrument behind such a number, and it would not tell you what to change.
            </p>
          </Card>
          <Card>
            <div className="gl-strong" style={{ marginBottom: 6 }}>No diagnosis</div>
            <p className="gl-small gl-muted">
              Anything clinical — a changing mole, a painful lump, persistent rash, hair loss with other symptoms — goes to a
              clinician. The advisor will help you write the timeline to take with you.
            </p>
          </Card>
          <Card>
            <div className="gl-strong" style={{ marginBottom: 6 }}>No unsafe plans</div>
            <p className="gl-small gl-muted">
              Bone smashing, mewing for bone change, self-injection, DIY enamel filing, extreme restriction, water cutting and
              non-prescribed hormones are refused with the reason attached, every time.
            </p>
          </Card>
          <Card>
            <div className="gl-strong" style={{ marginBottom: 6 }}>No invented facts</div>
            <p className="gl-small gl-muted">
              It will not name a product, price, retailer or review it does not have. If you have not entered it, the answer says
              so. Citations link to records in your own library.
            </p>
          </Card>
        </div>
        <Disclosure summary="How an answer is produced">
          <ol className="gl-advisor__how">
            <li>Safety and refusal rules are checked first — they can end a reply before anything else runs.</li>
            <li>The question is matched to an intent (today, hair, skin, purchase, style, progress, plan, fitness, discovery).</li>
            <li>That intent reads the relevant tables and reports only what your rows contain, with the record count shown.</li>
            <li>If nothing matches, the reply says it did not match a rule instead of producing confident noise.</li>
          </ol>
        </Disclosure>
      </Section>
    </>
  );
}

function Message({
  msg,
  onChip,
  onAccept
}: {
  msg: AnyRow;
  onChip: (c: string) => void;
  onAccept: (actionId: string) => void;
}) {
  const role = msg.role as 'user' | 'advisor' | 'system';
  const actions = (msg.pendingActions as AdvisorReply['pendingActions']) ?? [];
  const citations = (msg.citations as AdvisorReply['citations']) ?? [];
  const chips = role === 'advisor' ? ((msg.chips as string[]) ?? []) : [];
  return (
    <article className={`gl-msg gl-msg--${role}`}>
      {role !== 'system' ? (
        <div className="gl-msg__meta">
          <span>{role === 'user' ? 'You' : 'Glow Advisor'}</span>
          {role === 'advisor' ? <span>{String(msg.engine).replace('+provider', ' + your provider')}</span> : null}
          <span>{formatDate(msg.on)}</span>
        </div>
      ) : null}
      <div className="gl-msg__body">{msg.body}</div>
      {citations.length ? (
        <div className="gl-msg__attach">
          {citations.map((c) => (
            <Chip key={c.id + c.label} title={`${c.kind} record`}>
              <BookOpenCheck size={12} /> {c.label}
            </Chip>
          ))}
        </div>
      ) : null}
      {actions.length ? (
        <div className="gl-msg__attach">
          {actions.map((a) => (
            <Button key={a.id} size="sm" variant={a.accepted ? 'ghost' : 'default'} disabled={a.accepted} onClick={() => onAccept(a.id)}>
              {a.accepted ? 'Added' : `Add: ${a.label}`}
            </Button>
          ))}
        </div>
      ) : null}
      {chips.length ? (
        <div className="gl-row gl-row--tight" style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {chips.map((c) => (
            <button key={c} type="button" className="gl-chip gl-chip--clickable" onClick={() => onChip(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}


