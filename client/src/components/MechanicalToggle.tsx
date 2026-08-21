type MechanicalToggleProps = { active: boolean; disabled?: boolean; onClick: () => void };

export function MechanicalToggle({ active, disabled = false, onClick }: MechanicalToggleProps) {
  return <button type="button" className={`mechanical-toggle ${active ? "is-active" : ""}`} aria-pressed={active} aria-label={active ? "Approved for shredding" : "Rejected for shredding"} disabled={disabled} onClick={onClick}>
    <span className="mechanical-toggle__track" aria-hidden="true"><span className="mechanical-toggle__knob" /></span>
    <span className="mechanical-toggle__label">{active ? "APPROVE" : "REJECT"}</span>
  </button>;
}
