/**
 * Renders a generated form (model.ts) for any value of the project schema.
 * The value is edited immutably: every change hands a new value to onChange.
 */
import type { ReactNode } from 'react';
import { defaultValue, labelOf, variantOf } from './model.ts';
import type { DefaultContext, FieldSpec, RefKind } from './model.ts';

export interface FormContext extends DefaultContext {
  /** Choices for an id field: the items of its database (or of the open map). */
  options(ref: RefKind): { id: string; name: string }[];
  /** Frame names in an atlas, for FrameRef pickers. */
  frames(atlasId: string): string[];
  /** Validation messages by path (`a.b.0.c`), shown under their field. */
  issues: ReadonlyMap<string, string>;
  /** The name of whatever an id names, for record keys that are ids (faction relations). */
  nameOf?(id: string): string | undefined;
}

type Path = (string | number)[];

const keyOf = (path: Path): string => path.join('.');

function Issue({ path, ctx }: { path: Path; ctx: FormContext }) {
  const message = ctx.issues.get(keyOf(path));
  return message ? <div className="error">{message}</div> : null;
}

export function SchemaForm({ spec, value, onChange, ctx }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; ctx: FormContext }) {
  return <Field spec={spec} value={value} onChange={onChange} ctx={ctx} path={[]} label={null} />;
}

function Field({ spec, value, onChange, ctx, path, label }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; ctx: FormContext; path: Path; label: ReactNode }) {
  switch (spec.kind) {
    case 'object':
      if (spec.name === 'FrameRef') return <FrameRefField value={value as { atlasId: string; frame: string }} onChange={onChange} ctx={ctx} path={path} label={label} />;
      return <ObjectField spec={spec} value={(value ?? {}) as Record<string, unknown>} onChange={onChange} ctx={ctx} path={path} label={label} />;
    case 'variants': {
      const current = variantOf(spec, value);
      const tag = (value as Record<string, unknown> | null)?.[spec.discriminator];
      const choose = (next: string): void => {
        const variant = spec.variants.find((v) => v.values.map(String).includes(next))!;
        const tagValue = variant.values.find((v) => String(v) === next)!;
        onChange({ ...(defaultValue(variant.spec, ctx) as object), [spec.discriminator]: tagValue });
      };
      return (
        <div className="form-group">
          {label && <div className="form-label">{label}</div>}
          <div className="field">
            <label>{labelOf(spec.discriminator)}</label>
            <select value={String(tag ?? '')} onChange={(e) => choose(e.target.value)}>
              {spec.variants.flatMap((v) => v.values).map((v) => (
                <option key={String(v)} value={String(v)}>
                  {String(v)}
                </option>
              ))}
            </select>
          </div>
          {current && (
            <ObjectField spec={current.spec} value={(value ?? {}) as Record<string, unknown>} onChange={onChange} ctx={ctx} path={path} label={null} skip={spec.discriminator} inline />
          )}
          <Issue path={path} ctx={ctx} />
        </div>
      );
    }
    case 'choice': {
      // A plain union: pick the option whose kind fits the value, or let the author switch.
      const index = Math.max(0, spec.options.findIndex((o) => fits(o, value)));
      return (
        <div className="field">
          <label>{label}</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <select value={index} onChange={(e) => onChange(defaultValue(spec.options[Number(e.target.value)]!, ctx))} style={{ width: 90, flex: 'none' }}>
              {spec.options.map((o, i) => (
                <option key={i} value={i}>
                  {describe(o)}
                </option>
              ))}
            </select>
            <Field spec={spec.options[index]!} value={value} onChange={onChange} ctx={ctx} path={path} label={null} />
          </div>
        </div>
      );
    }
    case 'literal':
      if (spec.values.length === 1) {
        return label ? (
          <div className="field">
            <label>{label}</label>
            <code>{String(spec.values[0])}</code>
          </div>
        ) : (
          <code>{String(spec.values[0])}</code>
        );
      }
      return wrap(
        label,
        <select value={String(value)} onChange={(e) => onChange(spec.values.find((v) => String(v) === e.target.value))}>
          {spec.values.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>,
        path,
        ctx,
      );
    case 'string':
      return wrap(label, <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />, path, ctx);
    case 'id': {
      if (spec.ref === 'self') return wrap(label, <code className="muted" title={String(value)}>{String(value).slice(0, 8)}…</code>, path, ctx);
      const options = ctx.options(spec.ref);
      const known = options.some((o) => o.id === value);
      return wrap(
        label,
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {!known && <option value={String(value ?? '')}>{value ? `(missing ${String(value).slice(0, 8)})` : `(choose a ${spec.ref})`}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>,
        path,
        ctx,
      );
    }
    case 'number':
      return wrap(
        label,
        <input
          type="number"
          value={Number.isFinite(value as number) ? (value as number) : ''}
          step={spec.int ? 1 : 'any'}
          min={spec.min}
          max={spec.max}
          onChange={(e) => {
            const n = e.target.value === '' ? NaN : Number(e.target.value);
            onChange(spec.int ? Math.trunc(n) : n);
          }}
        />,
        path,
        ctx,
      );
    case 'boolean':
      return wrap(label, <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} style={{ width: 'auto' }} />, path, ctx);
    case 'array':
      return <ArrayField spec={spec} value={(value ?? []) as unknown[]} onChange={onChange} ctx={ctx} path={path} label={label} />;
    case 'record':
      return <RecordField spec={spec} value={(value ?? {}) as Record<string, unknown>} onChange={onChange} ctx={ctx} path={path} label={label} />;
    case 'tuple': {
      const items = (value ?? []) as unknown[];
      return wrap(
        label,
        <div style={{ display: 'flex', gap: 4 }}>
          {spec.items.map((item, i) => (
            <Field key={i} spec={item} value={items[i]} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} ctx={ctx} path={[...path, i]} label={null} />
          ))}
        </div>,
        path,
        ctx,
      );
    }
    case 'nullable':
      return (
        <div className="field">
          <label>{label}</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
              <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : defaultValue(spec.inner, ctx))} style={{ width: 'auto' }} />
              none
            </label>
            {value !== null && <Field spec={spec.inner} value={value} onChange={onChange} ctx={ctx} path={path} label={null} />}
          </div>
        </div>
      );
    case 'layer':
      return wrap(label, <span className="muted">edited on the map canvas</span>, path, ctx);
    case 'unsupported':
      return wrap(label, <span className="error">no form for {spec.type}</span>, path, ctx);
  }
}

function wrap(label: ReactNode, control: ReactNode, path: Path, ctx: FormContext) {
  if (!label) return control;
  return (
    <div className="field-block">
      <div className="field">
        <label>{label}</label>
        {control}
      </div>
      <Issue path={path} ctx={ctx} />
    </div>
  );
}

function fits(spec: FieldSpec, value: unknown): boolean {
  switch (spec.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
    case 'id':
      return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
    case 'literal':
      return spec.values.includes(value as never);
    default:
      return typeof value === 'object' && value !== null;
  }
}

function describe(spec: FieldSpec): string {
  if (spec.kind === 'literal') return spec.values.map(String).join('|');
  if (spec.kind === 'id') return spec.ref;
  return spec.kind;
}

function ObjectField({
  spec,
  value,
  onChange,
  ctx,
  path,
  label,
  skip,
  inline,
}: {
  spec: FieldSpec & { kind: 'object' };
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
  ctx: FormContext;
  path: Path;
  label: ReactNode;
  skip?: string;
  inline?: boolean;
}) {
  const set = (key: string, v: unknown): void => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  // An empty object is a marker (e.g. playerControlled): its presence is the datum.
  const body = spec.fields
    .filter((f) => f.key !== skip)
    .map((f) => {
      const present = value[f.key] !== undefined;
      const fieldPath = [...path, f.key];
      if (f.optional && !present) {
        return (
          <div key={f.key} className="field">
            <label className="muted">{labelOf(f.key)}</label>
            <button className="btn small" onClick={() => set(f.key, defaultValue(f.spec, ctx))}>
              + Add
            </button>
          </div>
        );
      }
      const marker = f.spec.kind === 'object' && f.spec.fields.length === 0;
      const title = (
        <span>
          {labelOf(f.key)}
          {f.optional && (
            <button className="btn small link" onClick={() => set(f.key, undefined)} title="Remove">
              ×
            </button>
          )}
        </span>
      );
      if (marker) {
        return (
          <div key={f.key} className="field">
            <label>{title}</label>
            <span className="muted">on</span>
          </div>
        );
      }
      return <Field key={f.key} spec={f.spec} value={value[f.key]} onChange={(v) => set(f.key, v)} ctx={ctx} path={fieldPath} label={title} />;
    });
  if (inline) return <>{body}</>;
  return (
    <div className="form-group">
      {label && <div className="form-label">{label}</div>}
      {body}
      <Issue path={path} ctx={ctx} />
    </div>
  );
}

function ArrayField({ spec, value, onChange, ctx, path, label }: { spec: FieldSpec & { kind: 'array' }; value: unknown[]; onChange: (v: unknown) => void; ctx: FormContext; path: Path; label: ReactNode }) {
  const set = (i: number, v: unknown): void => onChange(value.map((x, j) => (j === i ? v : x)));
  const remove = (i: number): void => onChange(value.filter((_, j) => j !== i));
  const move = (i: number, d: number): void => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item);
    onChange(next);
  };
  const canAdd = spec.maxLength === undefined || value.length < spec.maxLength;
  const simple = spec.element.kind === 'id' || spec.element.kind === 'string' || spec.element.kind === 'number' || spec.element.kind === 'literal';
  return (
    <div className="form-group">
      <div className="form-label">
        {label} <span className="muted">({value.length})</span>
      </div>
      {value.map((item, i) => (
        <div key={i} className={simple ? 'array-row' : 'array-item'}>
          <div className="array-tools">
            {!simple && <span className="muted">#{i + 1}</span>}
            <button className="btn small link" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              ↑
            </button>
            <button className="btn small link" disabled={i === value.length - 1} onClick={() => move(i, 1)} title="Move down">
              ↓
            </button>
            <button className="btn small link" disabled={value.length <= spec.minLength} onClick={() => remove(i)} title="Remove">
              ×
            </button>
          </div>
          <Field spec={spec.element} value={item} onChange={(v) => set(i, v)} ctx={ctx} path={[...path, i]} label={null} />
        </div>
      ))}
      {canAdd && (
        <button className="btn small" onClick={() => onChange([...value, defaultValue(spec.element, ctx)])}>
          + Add
        </button>
      )}
      <Issue path={path} ctx={ctx} />
    </div>
  );
}

function RecordField({ spec, value, onChange, ctx, path, label }: { spec: FieldSpec & { kind: 'record' }; value: Record<string, unknown>; onChange: (v: unknown) => void; ctx: FormContext; path: Path; label: ReactNode }) {
  const entries = Object.entries(value);
  return (
    <div className="form-group">
      <div className="form-label">{label}</div>
      {entries.map(([k, v]) => (
        <div key={k} className="array-row">
          <input type="text" value={ctx.nameOf?.(k) ?? k} title={k} readOnly style={{ width: 140, flex: 'none' }} />
          <Field spec={spec.value} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} ctx={ctx} path={[...path, k]} label={null} />
          <button
            className="btn small link"
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn small"
        onClick={() => {
          const key = window.prompt('Key');
          if (key && !(key in value)) onChange({ ...value, [key]: defaultValue(spec.value, ctx) });
        }}
      >
        + Add
      </button>
    </div>
  );
}

function FrameRefField({ value, onChange, ctx, path, label }: { value: { atlasId: string; frame: string } | undefined; onChange: (v: unknown) => void; ctx: FormContext; path: Path; label: ReactNode }) {
  const atlases = ctx.options('atlas');
  const atlasId = value?.atlasId ?? atlases[0]?.id ?? '';
  const frames = ctx.frames(atlasId);
  return (
    <div className="field-block">
      <div className="field">
        <label>{label}</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <select value={atlasId} onChange={(e) => onChange({ atlasId: e.target.value, frame: ctx.frames(e.target.value)[0] ?? value?.frame ?? '' })} style={{ flex: 1, minWidth: 0 }}>
            {atlases.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {frames.length > 0 ? (
            <select value={value?.frame ?? ''} onChange={(e) => onChange({ atlasId, frame: e.target.value })} style={{ flex: 1, minWidth: 0 }}>
              {!frames.includes(value?.frame ?? '') && <option value={value?.frame ?? ''}>{value?.frame || '(frame)'}</option>}
              {frames.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={value?.frame ?? ''} onChange={(e) => onChange({ atlasId, frame: e.target.value })} placeholder="frame" style={{ flex: 1, minWidth: 0 }} />
          )}
        </div>
      </div>
      <Issue path={path} ctx={ctx} />
    </div>
  );
}
