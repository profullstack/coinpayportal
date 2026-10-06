import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    beta = { messages: { create } };
  }
  return { default: Anthropic };
});

const claudeReply = (model: string, text: string) => ({
  model,
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
});

describe('answerQuestion model chain', () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    create.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    delete process.env.ASK_DATA_MODEL;
    delete process.env.ASK_DATA_FALLBACK_MODEL;
    delete process.env.ASK_DATA_OPENAI_MODEL;
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers with Claude Fable 5.1 first', async () => {
    create.mockResolvedValueOnce(claudeReply('claude-fable-5-1', '42 USD'));
    const { answerQuestion } = await import('./answer');
    const out = await answerQuestion('q', {});
    expect(out).toEqual({ answer: '42 USD', model: 'claude-fable-5-1', refused: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe('claude-fable-5-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to Opus 5.5 when Fable fails', async () => {
    create
      .mockRejectedValueOnce(new Error('Your credit balance is too low'))
      .mockResolvedValueOnce(claudeReply('claude-opus-5-5', 'from opus'));
    const { answerQuestion } = await import('./answer');
    const out = await answerQuestion('q', {});
    expect(out.model).toBe('claude-opus-5-5');
    expect(create.mock.calls[1][0].model).toBe('claude-opus-5-5');
  });

  it('falls back to OpenAI gpt-6-astra when both Claude models fail', async () => {
    create.mockRejectedValue(new Error('Your credit balance is too low'));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ model: 'gpt-6-astra', output_text: 'from astra' }), { status: 200 }),
    );
    const { answerQuestion } = await import('./answer');
    const out = await answerQuestion('q', { a: 1 });
    expect(out).toEqual({ answer: 'from astra', model: 'gpt-6-astra', refused: false });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-6-astra');
    expect(body.instructions).toContain('<snapshot>');
  });

  it('throws ModelUnavailableError when every provider fails', async () => {
    create.mockRejectedValue(new Error('down'));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'no credits' } }), { status: 429 }),
    );
    const { answerQuestion, ModelUnavailableError } = await import('./answer');
    await expect(answerQuestion('q', {})).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('uses OpenAI alone when there is no Anthropic key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ model: 'gpt-6-astra', output_text: 'ok' }), { status: 200 }),
    );
    const { answerQuestion, isAskEnabled } = await import('./answer');
    expect(isAskEnabled()).toBe(true);
    expect((await answerQuestion('q', {})).answer).toBe('ok');
    expect(create).not.toHaveBeenCalled();
  });
});
