import { useMemo } from 'react';
import { nextQuestion, questionProgress } from '@asi/shared';
import type { InterviewQuestion } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';

export function InterviewPanel() {
  const record = useSession((s) => s.record);
  const asked = useSession((s) => s.asked);
  const { answer } = useSession();

  const ctx = useMemo(() => ({ record, asked: new Set(asked) }), [record, asked]);
  const question = nextQuestion(ctx);
  const progress = questionProgress(ctx);

  if (!question) {
    return (
      <div className="panel">
        <p className="panel__done">That covers the questions for this area.</p>
        <p className="muted">
          {progress.answered} of {progress.total} questions answered. You can save now and add more later.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__progress" aria-hidden>
        <span style={{ width: `${(progress.answered / Math.max(progress.total, 1)) * 100}%` }} />
      </div>

      <p className="panel__meta">
        Question {progress.answered + 1} of {progress.total}
        {question.rationale && <span className="panel__why"> — {question.rationale}</span>}
      </p>

      <fieldset className="question">
        <legend className="question__prompt">{question.prompt}</legend>

        {question.options && (
          <div className={question.type === 'multi' ? 'options options--multi' : 'options'}>
            {question.options.map((opt) => (
              <button
                key={opt.value}
                className="option"
                onClick={() => {
                  answer(question.id, opt.value, [opt.value]);
                  if (question.highlightStructureIds) {
                    anatomy.apply({
                      type: 'highlight',
                      structureIds: question.highlightStructureIds,
                      as: 'candidate',
                    });
                  }
                }}
              >
                <span className="option__label">{opt.label}</span>
                {opt.hint && <span className="option__hint">{opt.hint}</span>}
              </button>
            ))}
          </div>
        )}

        {question.type === 'boolean' && (
          <div className="options">
            <button className="option" onClick={() => answer(question.id, 'true', ['true'])}>
              <span className="option__label">Yes</span>
            </button>
            <button className="option" onClick={() => answer(question.id, 'false', ['false'])}>
              <span className="option__label">No</span>
            </button>
          </div>
        )}

        {question.type === 'text' && (
          <TextAnswer question={question} onAnswer={(v) => answer(question.id, v, [v])} />
        )}
      </fieldset>
    </div>
  );
}

function TextAnswer({ question, onAnswer }: { question: InterviewQuestion; onAnswer: (v: string) => void }) {
  return (
    <form
      className="textanswer"
      onSubmit={(e) => {
        e.preventDefault();
        const input = (e.currentTarget.elements.namedItem('detail') as HTMLTextAreaElement) ?? null;
        if (input?.value.trim()) onAnswer(input.value.trim());
      }}
    >
      <textarea
        name="detail"
        rows={3}
        placeholder="e.g. arm up past about 90 degrees"
        autoFocus
      />
      <button type="submit" className="btn btn--primary">
        Continue
      </button>
    </form>
  );
}
