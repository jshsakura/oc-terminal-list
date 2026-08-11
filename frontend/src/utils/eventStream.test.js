import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openEventStream, _resetWorkerSupport } from './eventStream';

class FakeEventSource {
  static last = null;

  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeEventSource.last = this;
  }

  close() { this.closed = true; }
}

describe('openEventStream', () => {
  beforeEach(() => {
    _resetWorkerSupport();
    FakeEventSource.last = null;
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to a page EventSource where Worker does not exist', () => {
    vi.stubGlobal('Worker', undefined);

    const handle = openEventStream('/api/tab-state/events?ticket=t1', {});
    expect(handle.viaWorker).toBe(false);
    expect(FakeEventSource.last.url).toBe('/api/tab-state/events?ticket=t1');
  });

  it('delivers open/message/error from the page stream', () => {
    vi.stubGlobal('Worker', undefined);
    const onOpen = vi.fn(); const onMessage = vi.fn(); const onError = vi.fn();

    openEventStream('/x', { onOpen, onMessage, onError });
    FakeEventSource.last.onopen();
    FakeEventSource.last.onmessage({ data: '{"updatedAt":1}' });
    FakeEventSource.last.onerror();

    expect(onOpen).toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith('{"updatedAt":1}');
    expect(onError).toHaveBeenCalled();
  });

  it('closing the page stream closes the EventSource', () => {
    vi.stubGlobal('Worker', undefined);
    openEventStream('/x', {}).close();
    expect(FakeEventSource.last.closed).toBe(true);
  });

  describe('with a worker', () => {
    let worker;

    class FakeWorker {
      constructor() {
        this.posted = [];
        this.terminated = false;
        worker = this;
      }

      postMessage(msg) { this.posted.push(msg); }

      terminate() { this.terminated = true; }
    }

    beforeEach(() => { vi.stubGlobal('Worker', FakeWorker); worker = null; });

    it('hands the url to the worker instead of loading it on the page', () => {
      const handle = openEventStream('/api/tab-state/events?ticket=t2', {});
      expect(handle.viaWorker).toBe(true);
      expect(worker.posted[0]).toEqual({ type: 'connect', url: '/api/tab-state/events?ticket=t2' });
      expect(FakeEventSource.last).toBeNull();   // nothing loaded by the document
    });

    it('forwards worker messages to the handlers', () => {
      const onOpen = vi.fn(); const onMessage = vi.fn(); const onError = vi.fn();
      openEventStream('/x', { onOpen, onMessage, onError });

      worker.onmessage({ data: { type: 'open' } });
      worker.onmessage({ data: { type: 'message', data: 'payload' } });
      worker.onmessage({ data: { type: 'error' } });

      expect(onOpen).toHaveBeenCalled();
      expect(onMessage).toHaveBeenCalledWith('payload');
      expect(onError).toHaveBeenCalled();
    });

    it('falls back to the page when the worker reports no EventSource there', () => {
      // Older Safari: workers exist but EventSource inside them does not.
      openEventStream('/x', {});
      worker.onmessage({ data: { type: 'unsupported' } });

      expect(worker.terminated).toBe(true);
      expect(FakeEventSource.last.url).toBe('/x');
    });

    it('stops trying workers once one has failed — the cost is paid per app load, not per reconnect', () => {
      openEventStream('/x', {});
      worker.onerror();

      const second = openEventStream('/y', {});
      expect(second.viaWorker).toBe(false);
    });

    it('close() tells the worker and terminates it', () => {
      openEventStream('/x', {}).close();
      expect(worker.posted).toContainEqual({ type: 'close' });
      expect(worker.terminated).toBe(true);
    });

    it('a message arriving after close does not reach the handlers', () => {
      const onMessage = vi.fn();
      const handle = openEventStream('/x', { onMessage });
      handle.close();
      worker.onmessage({ data: { type: 'message', data: 'late' } });
      expect(onMessage).not.toHaveBeenCalled();
    });
  });
});
