"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, ArrowUpRight, BookOpen, Check, CheckCheck, CheckCircle2, Clock3, FileText, History as HistoryIcon, LoaderCircle, UploadCloud, X } from "lucide-react";
import { BOOKING_LABELS, LAB_LABELS, formatDate, initials, type BookingStatus, type HistoryItem, type LabFile, type LabStatus, type WorkspaceData } from "@/lib/types";

export type ModalState =
  | { kind: "booking"; startAt: string; labId?: number }
  | { kind: "cancel" | "reschedule" | "review"; bookingId: string }
  | { kind: "lab"; labId: number; teamId?: number }
  | { kind: "help" | "profile" | "login" | "create-course" | "create-team" | "all-bookings" }
  | { kind: "create-lab"; labId?: number }
  | { kind: "team"; teamId: number }
  | { kind: "credentials"; username: string; password: string; number: number };
export interface MutationResult { message: string; data: WorkspaceData; credentials?: { username: string; password: string; number: number }; courseId?: number }
export type Mutate = (input: Record<string, unknown>, file?: File | null) => Promise<MutationResult | null>;

export function Brand() {
  return <span className="brand"><svg width="34" height="37" viewBox="0 0 38 40" fill="none" aria-hidden="true"><path d="M5 9.5C5 7.57 6.57 6 8.5 6H18V31H8.5C6.57 31 5 29.43 5 27.5V9.5Z" fill="currentColor" transform="rotate(13 12 19)"/><path d="M21 7.5C21 5.57 22.57 4 24.5 4H34V29H24.5C22.57 29 21 27.43 21 25.5V7.5Z" fill="currentColor" transform="rotate(13 28 17)"/><path d="M5 9.5C5 7.57 6.57 6 8.5 6H18V14H5V9.5Z" fill="#B7A0ED" transform="rotate(13 12 19)"/></svg><span>Пары<span className="brand-period">.</span></span></span>;
}
export function Avatar({ name, className = "", color = 0 }: { name: string; className?: string; color?: number }) { return <span className={`avatar avatar-${color % 5} ${className}`}>{initials(name)}</span>; }
export function StatusBadge({ status, kind = "lab" }: { status: string; kind?: "lab" | "booking" }) { const label = kind === "lab" ? LAB_LABELS[status as LabStatus] : BOOKING_LABELS[status as BookingStatus]; return <span className={`status-badge status-${status}`}>{["confirmed", "completed"].includes(status) ? <Check size={11} strokeWidth={2.5} /> : <span className="status-dot" />}{label || status}</span>; }
export function Spinner() { return <LoaderCircle className="spin" size={17} />; }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon"><BookOpen size={27} /></span><h3>{title}</h3><p>{description}</p>{action}</div>; }

export function Modal({ title, description, icon, children, footer, onClose, wide = false, dismissible = true }: { title: string; description?: string; icon?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; dismissible?: boolean }) {
  const id = useId(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const timer = setTimeout(() => ref.current?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,button,a[href]")?.focus(), 60);
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
      if (event.key === "Tab") { const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'); if (!focusable?.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    document.addEventListener("keydown", listener);
    return () => { clearTimeout(timer); document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", listener); previous?.focus(); };
  }, [dismissible, onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && dismissible) onClose(); }}><div ref={ref} className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id}><div className="modal-header">{icon && <span className="modal-icon">{icon}</span>}<div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{dismissible && <button className="icon-button modal-close" onClick={onClose} aria-label="Закрыть окно"><X size={20} /></button>}</div><div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}</div></div>;
}

export function FileUpload({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false);
  const accept = (value?: File) => { if (!value) return; if (!value.name.toLowerCase().endsWith(".pdf")) { setError("Выберите файл в формате PDF"); return; } if (value.size > 10 * 1024 * 1024) { setError("Размер файла не должен превышать 10 МБ"); return; } setError(""); onChange(value); };
  return <div><input ref={ref} type="file" accept=".pdf,application/pdf" className="sr-only" tabIndex={-1} onChange={e => { accept(e.target.files?.[0]); e.target.value = ""; }} aria-label="Загрузить PDF-отчёт" />{file ? <div className="selected-file"><span className="pdf-icon"><FileText size={21} /></span><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} КБ · Готов к загрузке</small></div><button type="button" className="icon-button" onClick={() => onChange(null)} aria-label="Убрать файл"><X size={17} /></button></div> : <button type="button" className={`file-drop ${dragging ? "dragging" : ""}`} onClick={() => ref.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files[0]); }}><span className="upload-icon"><UploadCloud size={24} /></span><strong><span>Нажмите для загрузки</span> или перетащите файл</strong><small>Только PDF, не более 10 МБ</small></button>}{error && <p className="field-error" role="alert">{error}</p>}</div>;
}
export function FileList({ files }: { files: LabFile[] }) { return files.length ? <div className="file-list">{files.map((file, i) => <a className="file-row" key={file.id} href={`/api/files/${file.id}`} target="_blank" rel="noreferrer"><span className="pdf-icon"><FileText size={21} /></span><span className="file-row-info"><strong>{file.name}</strong><small>{formatDate(file.createdAt, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {(file.size / 1024).toFixed(0)} КБ</small></span><span className={`version-badge ${i === 0 ? "latest" : ""}`}>v{file.version}{i === 0 && <Check size={10} />}</span><ArrowUpRight size={16} /></a>)}</div> : <div className="inline-empty"><FileText size={24} /><p>Пока нет загруженных файлов</p><small>PDF-отчёт появится здесь после отправки заявки.</small></div>; }
export function HistoryList({ items }: { items: HistoryItem[] }) {
  const labels: Record<string, string> = { status: "Обновлён статус работы", file: "Загружен отчёт", booking: "Отправлена заявка", confirmed: "Бронь подтверждена", completed: "Работа принята", cancelled: "Бронь отменена", rescheduled: "Выбрано новое время", no_show: "Неявка на встречу", revision: "Работа возвращена", rejected: "Заявка отклонена", assigned: "Назначена работа", profile: "Данные бригады обновлены", team_created: "Создана бригада" };
  return items.length ? <div className="history-list">{items.map(item => <div className="history-item" key={item.id}><span className={`history-marker history-${item.action}`}>{item.action === "file" ? <FileText size={14} /> : item.action === "rescheduled" ? <ArrowLeftRight size={14} /> : ["confirmed", "completed"].includes(item.action) ? <CheckCheck size={14} /> : <Clock3 size={14} />}</span><div><div className="history-item-heading"><strong>{labels[item.action] || "Действие в системе"}</strong><time>{formatDate(item.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div><p>{item.detail}</p><small>{item.actor}</small></div></div>)}</div> : <div className="inline-empty"><HistoryIcon size={25} /><p>История только начинается</p><small>Здесь сохранятся все действия с лабораторной работой.</small></div>;
}

export function PrepIllustration() {
  return <svg className="prep-illustration" width="132" height="98" viewBox="0 0 132 98" fill="none" aria-hidden="true"><ellipse cx="68" cy="79" rx="47" ry="9" fill="#E6DDFB"/><path d="m30 31 35 9 37-17v47L66 86 30 72V31Z" fill="#B39ADF"/><path d="M65 36 33 25l-9 6v39l40 12 40-17V25l-11-7-28 18Z" fill="#7E59CB"/><path d="m65 39-34-12v39l34 12V39Z" fill="#FDFBFF"/><path d="m65 39 34-15v40L65 78V39Z" fill="#F2ECFD"/><path d="m37 39 21 7m-21 1 21 7m-21 2 14 5" stroke="#CCBAEC" strokeWidth="2" strokeLinecap="round"/><path d="m72 44 19-8m-19 16 19-8m-19 16 13-6" stroke="#C5AFE8" strokeWidth="2" strokeLinecap="round"/><path d="m64 39 1 39" stroke="#DCCDF2" strokeWidth="1.5"/><rect x="83" y="8" width="27" height="20" rx="6" transform="rotate(10 83 8)" fill="#E7DDFB"/><path d="m90 19 3 4 7-6" stroke="#8257CF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 14v9m-4.5-4.5h9M115 46v7m-3.5-3.5h7" stroke="#C4ADEA" strokeWidth="2" strokeLinecap="round"/><circle cx="40" cy="14" r="2.5" fill="#CFBFEE"/><circle cx="110" cy="76" r="2" fill="#BBA2E5"/></svg>;
}
