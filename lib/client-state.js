// Browser-neutral controller. All asynchronous writes are tied to one empty draft revision.
export function eligible(s) {
  return !!s?.sessionId && s.running === false && !s.pending && s.phase === 'plain'
    && s.draft === '' && !s.attachments && !s.references && !s.queue && !s.composing && !s.menu && !s.conflict;
}
export function createController({ rpc, read, changed = () => {}, now = Date.now, makeId = () => globalThis.crypto.randomUUID() }) {
  let config = null, configRevision = -1, current = null, generation = 0, attempted = false;
  let request = null, offer = null, disposed = false, last = { text: '', reason: 'loading', phase: 'idle' };
  const publish = (text, reason, phase = 'idle') => {
    const next = { text, reason, phase, model: offer?.model || '' };
    if (JSON.stringify(next) !== JSON.stringify(last)) { last = next; changed(next); }
  };
  const cancel = () => {
    const r = request; request = null;
    if (r) { r.controller.abort(); void rpc({ action: 'cancel', sessionId: r.sessionId, requestId: r.id }).catch(() => {}); }
  };
  const invalidate = () => { generation++; cancel(); offer = null; attempted = false; };
  function configure(next, revision = configRevision + 1) {
    if (revision !== configRevision) { invalidate(); configRevision = revision; }
    config = next; update();
  }
  function update() {
    if (disposed) return;
    const s = read();
    if (!current || s.sessionId !== current.sessionId || s.running !== current.running) invalidate();
    current = { ...s };
    if (!config?.enabled) { cancel(); offer = null; publish('', config ? 'disabled' : 'loading'); return; }
    if (!eligible(s)) {
      cancel();
      if (offer && (s.draftRev !== offer.draftRev || s.running !== false)) offer = null;
      publish('', s.conflict ? 'conflict' : 'idle'); return;
    }
    if (offer) {
      if (offer.draftRev !== s.draftRev) offer = null;
      else { publish(offer.text, 'ready', 'offered'); return; }
    }
    if (attempted || request) return;
    attempted = true;
    const ticket = { id: makeId(), sessionId: s.sessionId, draftRev: s.draftRev, generation, controller: new AbortController(), started: now() };
    request = ticket; publish('', 'requesting', 'requesting');
    Promise.resolve().then(() => rpc({ action: 'predict', sessionId: s.sessionId, requestId: ticket.id }, ticket.controller.signal)).then(result => {
      if (disposed || request !== ticket || ticket.controller.signal.aborted || generation !== ticket.generation) return;
      request = null;
      const live = read();
      if (!eligible(live) || live.sessionId !== ticket.sessionId || live.draftRev !== ticket.draftRev) { publish('', 'stale'); return; }
      if (!result?.ok) { publish('', 'connection-error'); return; }
      const value = result.value;
      if (!value?.suggestion || !value.revision) { publish('', value?.reason || 'no-suggestion'); return; }
      offer = { text: value.suggestion, revision: value.revision, draftRev: live.draftRev, sessionId: live.sessionId, model: value.model };
      publish(offer.text, 'ready', 'offered');
    }).catch(() => {
      if (request === ticket && !disposed) { request = null; publish('', ticket.controller.signal.aborted ? 'cancelled' : 'connection-error'); }
    });
  }
  return {
    configure, update,
    snapshot: () => last,
    accept(insert) {
      const s = read();
      if (!config?.enabled || !offer || !eligible(s) || offer.sessionId !== s.sessionId || offer.draftRev !== s.draftRev) { offer = null; publish('', 'stale'); return false; }
      const accepted = insert(offer.text) === true;
      if (!accepted) { offer = null; publish('', 'stale'); return false; }
      offer = null; attempted = true; publish('', 'accepted');
      void rpc({ action: 'feedback', kind: 'accepted' }).catch(() => {});
      return true;
    },
    dismiss() {
      if (!offer || !eligible(read())) return false;
      offer = null; attempted = true; cancel(); publish('', 'dismissed');
      void rpc({ action: 'feedback', kind: 'dismissed' }).catch(() => {});
      return true;
    },
    dispose() { disposed = true; cancel(); offer = null; },
  };
}
