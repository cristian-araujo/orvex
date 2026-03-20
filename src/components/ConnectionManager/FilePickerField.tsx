import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  filters?: { name: string; extensions: string[] }[];
  disabled?: boolean;
}

export function FilePickerField({ label, value, onChange, filters, disabled }: Props) {
  const browse = async () => {
    const selected = await open({
      multiple: false,
      filters: filters ?? [{ name: "All Files", extensions: ["*"] }],
    });
    if (selected) {
      onChange(selected as string);
    }
  };

  return (
    <>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ flex: 1 }}
          placeholder="(none)"
        />
        <button
          className="btn-secondary"
          style={{ padding: "2px 8px", fontSize: 11, whiteSpace: "nowrap" }}
          onClick={browse}
          disabled={disabled}
        >
          Browse...
        </button>
      </div>
    </>
  );
}
