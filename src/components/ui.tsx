"use client";

import type { ReactNode } from "react";

/** Small shared primitives so the panels stay readable. */

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  title,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    default: "bg-[#22262e] hover:bg-[#2b303a] text-[#e9ecf1] border-[#333a45]",
    primary: "bg-[#7c6bff] hover:bg-[#6b59f5] text-white border-transparent",
    ghost: "bg-transparent hover:bg-[#22262e] text-[#8b93a1] border-transparent",
    danger: "bg-transparent hover:bg-[#3a1f24] text-[#f27b7b] border-transparent",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-b border-[#262a32] px-4 py-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b93a1]">
          {title}
        </h3>
        {actions}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[#8b93a1]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[#5f6674]">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-[#333a45] bg-[#1a1d23] px-2.5 py-1.5 text-xs text-[#e9ecf1] outline-none transition-colors focus:border-[#7c6bff] placeholder:text-[#5f6674]";

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className={inputClass}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className={`${inputClass} resize-y leading-relaxed`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        className={inputClass}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#5f6674]">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      className={inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-[#1a1d23]">
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 shrink-0"
      />
      <input
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

/** <input type="color"> only accepts #rrggbb; fall back rather than warn. */
function normalizeHex(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return "#000000";
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-[#333a45]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
            value === option.value
              ? "bg-[#7c6bff] text-white"
              : "bg-[#1a1d23] text-[#8b93a1] hover:bg-[#22262e]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-[#7c6bff]"
    />
  );
}
