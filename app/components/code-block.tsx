import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Highlight, themes } from "prism-react-renderer"
import { Button } from "#/components/ui/button"

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className ?? "h-7 px-2 text-xs"}
      aria-label="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        } catch {}
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
}

export function CodeBlock({ code, language = "markup" }: { code: string; language?: string }) {
  return (
    <div className="relative min-w-0">
      <CopyButton text={code} className="absolute top-2 right-2 z-10 h-7 px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white" />
      <Highlight theme={themes.vsDark} code={code} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={className}
            style={{ ...style, margin: 0, borderRadius: "0.375rem", fontSize: "0.75rem", padding: "0.75rem 3rem 0.75rem 0.75rem", overflowX: "auto" }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  )
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
}

export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{value}</code>
      <CopyButton text={value} className="h-auto shrink-0 border px-3" />
    </div>
  )
}
