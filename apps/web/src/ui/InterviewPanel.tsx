import { useEffect, useRef, useState } from 'react';
import { nextQuestion, questionProgress, REGIONS } from '@asi/shared';
import type { InterviewQuestion } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';
import { EmptyState, StatusTag } from './primitives.tsx';

export function InterviewPanel() {
  const { record, asked, answer } = useSession();
  const context = { record, asked: new Set(asked) };
  const question = nextQuestion(context);
  const progress = questionProgress(context);

  if (!question) return <EmptyState title="The questions for this area are complete." action={<p className="small">Review the details before saving your episode.</p>}>{progress.answered} answers added to this session. This is a symptom record, not a diagnosis.</EmptyState>;

  return <section className="panel interview-panel" aria-label="Current question">
    <div className="interview-progress"><span>{REGIONS[record.location.region].label} details</span><span>{progress.answered} of {progress.total} answered</span></div>
    <progress value={progress.answered} max={Math.max(progress.total, 1)} aria-label="Questions answered" />
    <QuestionForm key={question.id} question={question} onAnswer={(value, values) => {
      answer(question.id, value, values);
      if (question.highlightStructureIds) anatomy.apply({ type: 'highlight', structureIds: question.highlightStructureIds, as: 'candidate' });
    }} />
  </section>;
}

function QuestionForm({ question, onAnswer }: { question: InterviewQuestion; onAnswer: (value: unknown, values: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const prompt = useRef<HTMLLegendElement>(null);
  useEffect(() => { prompt.current?.focus(); }, []);
  const isMulti = question.type === 'multi';
  const isText = question.type === 'text';
  const options = question.type === 'boolean' ? [{value: 'true', label: 'Yes'}, {value: 'false', label: 'No'}] : question.options;
  const canContinue = isText ? Boolean(text.trim()) : selected.length > 0;

  return <form onSubmit={(event) => {
    event.preventDefault();
    if (!canContinue) return;
    const values = isText ? [text.trim()] : selected;
    onAnswer(isMulti ? values : values[0], values);
  }}>
    <div className="question-context">{question.safetyRuleId && <StatusTag>Safety-related question</StatusTag>}<span className="small">{question.required ? 'Required question' : 'Optional question'}</span></div>
    <fieldset className="question" aria-describedby="question-instruction">
      <legend className="question__prompt" ref={prompt} tabIndex={-1}>{question.prompt}</legend>
      <p id="question-instruction" className="small">{isMulti ? 'Select all that apply, then continue.' : isText ? 'Answer in your own words.' : 'Select one answer, then continue.'}</p>
      {options && <div className={`answer-options ${isMulti ? 'answer-options--multi' : ''}`}>{options.map((option) => <label key={option.value} className={`answer-option ${selected.includes(option.value) ? 'answer-option--selected' : ''}`}>
        <input type={isMulti ? 'checkbox' : 'radio'} name={question.id} value={option.value} checked={selected.includes(option.value)} onChange={(event) => setSelected(isMulti ? event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value) : [option.value])} />
        <span><span className="option__label">{option.label}</span>{'hint' in option && <span className="option__hint">{option.hint}</span>}</span>
      </label>)}</div>}
      {isText && <><label htmlFor="question-answer" className="sr-only">Your answer</label><textarea id="question-answer" rows={4} value={text} onChange={(event) => setText(event.target.value)} /></>}
      {!options && !isText && <p className="notice">This question format is not available in this prototype. Your existing answers remain in the current record.</p>}
    </fieldset>
    {question.rationale && <details className="question-rationale"><summary>Why we ask this</summary><p>{question.rationale}</p></details>}
    <div className="actions"><span className="small">{isMulti && selected.length > 0 ? `${selected.length} selected` : 'Your answer is added when you continue.'}</span><button className="btn btn--primary" disabled={!canContinue}>Continue</button></div>
  </form>;
}
