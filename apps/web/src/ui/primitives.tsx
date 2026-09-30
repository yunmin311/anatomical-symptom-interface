import type { ReactNode } from 'react';

export function StatusTag({
  kind = 'neutral',
  children,
}: {
  kind?: 'neutral' | 'candidate' | 'selected';
  children: ReactNode;
}) {
  return <span className={`status-tag status-tag--${kind}`}>{children}</span>;
}

export function PageHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <h1 id="page-title" tabIndex={-1}>
        {title}
      </h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p className="muted">{children}</p>
      {action}
    </section>
  );
}

export function FactList({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="facts">
      {rows.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="choice-group">
      <legend>{label}</legend>
      <div className="choice-group__options">
        {options.map((option) => (
          <label
            className={`choice ${value === option.value ? 'choice--selected' : ''}`}
            key={option.value}
          >
            <input
              type="radio"
              name={label}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
