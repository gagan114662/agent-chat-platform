interface ToolViewProps {
  name: string;
  content: string;
}

// #99 ToolView renders a persistent internal tool's HTML content.
// SECURITY: the content is rendered ONLY inside a `sandbox=""` iframe via srcDoc —
// the exact #59 safe-HTML pattern (FilePreview). An empty sandbox disables scripts,
// forms and navigation, so even attacker-authored HTML cannot run script in the
// host document. There is NO `dangerouslySetInnerHTML` anywhere.
export function ToolView({ name, content }: ToolViewProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <iframe
        title={name}
        sandbox=""
        srcDoc={content}
        className="h-full min-h-96 w-full"
      />
    </div>
  );
}
