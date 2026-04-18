export default function Modal({ open, title, subtitle, children, onClose, width = "wide" }) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        className={`modal-card modal-card--${width}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
