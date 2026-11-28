import React, { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

const cx = (...names) => names.filter(Boolean).join(' ');

/** Scope both CSS and semantic colors. Nest a skin only where a native flow differs. */
export function Surface({ as: Tag = 'div', skin = 'commerce', className, children, ...props }) {
  return <Tag {...props} className={cx('sc1', className)} data-sc1-skin={skin}>{children}</Tag>;
}

export const Button = forwardRef(function Button({ variant = 'primary', size = 'default', loading = false, disabled, icon, children, className, type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx('sc1-button', `sc1-button--${variant}`, `sc1-button--${size}`, className)}>
    {loading ? <span className="sc1-spinner" aria-hidden="true"/> : icon ? <Icon name={icon} size={20}/> : null}<span>{children}</span>
  </button>;
});

export const IconButton = forwardRef(function IconButton({ label, icon, className, ...props }, ref) {
  return <button type="button" {...props} ref={ref} aria-label={label} title={label} className={cx('sc1-icon-button', className)}><Icon name={icon}/></button>;
});

export const Field = forwardRef(function Field({ label, hint, error, id: providedId, className, options, multiline, variant, ...props }, ref) {
  const autoId = useId(), id = providedId || autoId;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const password = props.type === 'password';
  const description = [props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const common = { ...props, id, ref, className: 'sc1-input', 'aria-invalid': error ? true : props['aria-invalid'], 'aria-describedby': description };
  return <div className={cx('sc1-field', variant === 'auth' && 'sc1-field--auth', className)}>
    <label className="sc1-field-label" htmlFor={id}>{label}{props.required && <span aria-hidden="true"> *</span>}</label>
    {options ? <select {...common}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : multiline ? <textarea rows={4} {...common}/> : password ? <div className="sc1-password"><input {...common} type={passwordVisible && !props.disabled ? 'text' : 'password'}/><button type="button" disabled={props.disabled} aria-label={`${passwordVisible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? 'Hide' : 'Show'}</button></div> : <input {...common}/>}
    {hint && <p className="sc1-field-hint" id={`${id}-hint`}>{hint}</p>}
    {error && <p className="sc1-field-error" id={`${id}-error`}>{error}</p>}
  </div>;
});

export function SearchField({ value, onChange, onSubmit, label = 'Search orders by number, customer, dealer or distributor', placeholder = 'Search by order or name', className }) {
  const id = useId();
  return <form role="search" aria-label={label} onSubmit={event => { event.preventDefault(); onSubmit?.(value); }} className={cx('sc1-search', className)}>
    <label className="sc1-sr-only" htmlFor={id}>{label}</label><Icon name="search" size={20}/>
    <input id={id} type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}/>
    {value && <IconButton icon="close" label="Clear search" onClick={() => onChange('')}/>}
    {onSubmit && <IconButton icon="chevron-right" label="Submit search" type="submit"/>}
  </form>;
}

/** Native radio behavior supplies arrow keys, focus and form serialization. */
export function ChoiceGroup({ label, options, value, onChange, name, variant = 'chips' }) {
  const id = useId();
  return <fieldset className={cx('sc1-choices', `sc1-choices--${variant}`)}><legend className="sc1-sr-only">{label}</legend>
    {options.map(option => <label key={option.value} className="sc1-choice"><input type="radio" name={name || id} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)}/><span>{option.label}</span></label>)}
  </fieldset>;
}

export function Checkbox({ label, hint, className, ...props }) {
  return <label className={cx('sc1-check', className)}><input type="checkbox" {...props}/><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span></label>;
}

export function Switch({ label, ...props }) {
  return <label className="sc1-switch"><span>{label}</span><input type="checkbox" role="switch" {...props}/><span className="sc1-switch-track" aria-hidden="true"/></label>;
}

export function Tabs({ label, items, value, onChange }) {
  const id = useId(), refs = useRef([]), selected = Math.max(0, items.findIndex(item => item.value === value));
  function move(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); onChange(items[next].value); refs.current[next]?.focus();
  }
  return <div className="sc1-tabs"><div className="sc1-tab-list" role="tablist" aria-label={label}>
    {items.map((item, index) => <button type="button" key={item.value} ref={el => { refs.current[index] = el; }} id={`${id}-tab-${index}`} role="tab" aria-selected={selected === index} aria-controls={`${id}-panel-${index}`} tabIndex={selected === index ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={event => move(event, index)}>{item.label}</button>)}
  </div>{items.map((item, index) => <div key={item.value} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={selected !== index} className="sc1-tab-panel">{item.content}</div>)}</div>;
}

export function Card({ as: Tag = 'div', tone, className, children, ...props }) {
  return <Tag {...props} className={cx('sc1-card', tone && `sc1-card--${tone}`, className)}>{children}</Tag>;
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={cx('sc1-badge', `sc1-badge--${tone}`)}><span aria-hidden="true"/>{children}</span>;
}

export function Notice({ tone = 'info', title, children, live = false }) {
  return <div className={cx('sc1-notice', `sc1-notice--${tone}`)} role={live ? 'status' : undefined}><Icon name={tone === 'success' ? 'check' : 'info'} size={20}/><div>{title && <strong>{title}</strong>}<div>{children}</div></div></div>;
}

export function EmptyState({ icon = 'orders', title, children, action }) {
  return <div className="sc1-empty"><span className="sc1-empty-icon"><Icon name={icon} size={28}/></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Skeleton({ label = 'Loading content', lines = 3 }) {
  return <div className="sc1-skeleton" role="status" aria-busy="true"><span className="sc1-sr-only">{label}</span>{Array.from({ length: lines }, (_, i) => <span key={i} aria-hidden="true"/>)}</div>;
}

export function Avatar({ name, image, size = 'default' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('');
  return <span className={cx('sc1-avatar', `sc1-avatar--${size}`)} aria-hidden="true">{image ? <img src={image} alt=""/> : initials}</span>;
}

export function PersonRow({ name, detail, type = 'Customer', onOpen }) {
  return <div className="sc1-person"><Avatar name={name}/><div><strong>{name}</strong><p>{type}{detail && ` · ${detail}`}</p></div>{onOpen && <IconButton label={`View ${name}`} icon="chevron-right" onClick={onOpen}/>}</div>;
}

/** Display-only facts; caller owns currency, dates, permission and party resolution. */
export function OrderCard({ order, onOpen }) {
  const id = useId();
  return <Card as="article" className="sc1-order" aria-labelledby={id}>
    <div className="sc1-order-top"><span className="sc1-order-symbol"><Icon name="orders"/></span><div className="sc1-grow"><p className="sc1-caption">{order.kind}</p><h3 id={id}>Order #{order.id}</h3></div><Badge tone={order.status === 'Completed' ? 'success' : order.status === 'Cancelled' ? 'neutral' : 'warning'}>{order.status}</Badge></div>
    <div className="sc1-order-party"><span className="sc1-caption">{order.partyType || 'Customer'}</span><strong>{order.party || 'Name unavailable'}</strong>{order.relatedParty && <span className="sc1-caption">{order.relatedParty}</span>}</div>
    <dl className="sc1-order-facts"><div><dt>Placed on</dt><dd>{order.placed}</dd></div><div><dt>Due date</dt><dd>{order.due}</dd></div><div><dt>Total quantity</dt><dd>{order.quantity} pcs</dd></div></dl>
    <div className="sc1-order-footer"><div><strong className="sc1-numeric">{order.amount}</strong><p className="sc1-caption">{order.payment}</p></div>{onOpen && <IconButton icon="chevron-right" label={`View order ${order.id}`} onClick={() => onOpen(order)}/>}</div>
  </Card>;
}

export function ProductCard({ name, category, price, image, visual, onOpen }) {
  return <Card as="article" className="sc1-product"><div className="sc1-product-visual">{image ? <img src={image} alt={name} loading="lazy"/> : visual || <Icon name="image" size={48}/>}</div><div className="sc1-product-copy"><p className="sc1-caption">{category}</p><h3>{name}</h3><div className="sc1-between"><strong className="sc1-numeric">{price}</strong>{onOpen && <IconButton icon="plus" label={`Configure ${name}`} onClick={onOpen}/>}</div></div></Card>;
}

export function OptionCard({ name, value, label, detail, checked, onChange, visual, disabled }) {
  return <label className="sc1-option"><input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled}/><span className="sc1-option-body">{visual && <span className="sc1-option-visual">{visual}</span>}<strong>{label}</strong>{detail && <small>{detail}</small>}<span className="sc1-option-check" aria-hidden="true">{checked ? <Icon name="check" size={14}/> : null}</span></span></label>;
}

export function ProgressSteps({ label, steps, current = 0 }) {
  return <ol className="sc1-progress" aria-label={label}>{steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined} data-complete={index < current}><span className="sc1-progress-marker" aria-hidden="true">{index < current ? <Icon name="check" size={14}/> : index + 1}</span><span>{step}<span className="sc1-sr-only">{index < current ? ', completed' : index === current ? ', current' : ', upcoming'}</span></span></li>)}</ol>;
}

export function Accordion({ title, children, ...props }) {
  return <details className="sc1-accordion" {...props}><summary>{title}<Icon name="chevron-right" size={18}/></summary><div>{children}</div></details>;
}

/** Links, not application tabs: browser navigation retains open-in-new-tab behavior. */
export function Dock({ items, label = 'Main navigation' }) {
  return <nav className="sc1-dock" aria-label={label}>{items.map(item => <a key={item.label} href={item.href} aria-current={item.active ? 'page' : undefined}><Icon name={item.icon} size={27}/><span>{item.label}</span>{item.count > 0 && <span className="sc1-dock-count" aria-label={`${item.count} items`}>{item.count}</span>}</a>)}</nav>;
}

/** Native modal dialog provides inert background, focus containment and Escape support. */
export function Sheet({ open, onOpenChange, title, description, children, footer, skin = 'commerce' }) {
  const ref = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current, opener = document.activeElement, previousOverflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus(); };
  }, [open]);
  function containTab(event) {
    if (event.key !== 'Tab') return;
    const candidates = [...ref.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')];
    const focusable = candidates.filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[hidden], [inert]'));
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); ref.current.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <dialog ref={ref} className="sc1 sc1-sheet" data-sc1-skin={skin} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} onKeyDown={containTab} onCancel={event => { event.preventDefault(); onOpenChange(false); }} onClick={event => {
    if (event.target !== ref.current) return;
    const box = ref.current.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onOpenChange(false);
  }}>
    <div className="sc1-sheet-handle" aria-hidden="true"/><header className="sc1-sheet-header"><h2 id={`${id}-title`}>{title}</h2><IconButton icon="close" label="Close dialog" onClick={() => onOpenChange(false)}/></header>
    <div className="sc1-sheet-content">{description && <p id={`${id}-description`} className="sc1-muted">{description}</p>}{children}</div>
    {footer && <footer className="sc1-sheet-footer">{footer}</footer>}
  </dialog>;
}
