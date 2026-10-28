/** What a provider needs to know about a source. */
export type ProviderSource = { repository: string; token: string; webhook_secret: string }

/** What a webhook delivery announces, once its signature is verified. */
export type WebhookEvent =
  /** The provider's test delivery, sent when the webhook is created. */
  | { kind: "ping" }
  /** A tag was created or moved. `commit` is the commit it points to; `repository_id` identifies the repository. */
  | { kind: "tag"; tag: string; commit: string; repository_id: number | null; repository: string }
  /** A delivery that publishes nothing, for example a branch push. */
  | { kind: "ignored"; reason: string }

export type ProviderFailure = { error: string; status: number }

/**
 * A hosting service that release sources can connect to. Each provider verifies its own webhook deliveries and
 * downloads repository archives; everything else (versions, repacking, storage) is shared.
 */
export interface SourceProvider {
  /** Verifies the delivery's signature and reads what it announces. */
  readWebhook(request: Request, body: string, source: ProviderSource): Promise<WebhookEvent | ProviderFailure>
  /** Checks that the repository exists and can be read with the source's token. */
  checkAccess(source: ProviderSource): Promise<{ ok: true; private: boolean; id: number | null } | ProviderFailure>
  /** Resolves a reference (tag, branch or commit) to its commit. */
  resolveCommit(source: ProviderSource, ref: string): Promise<{ commit: string } | ProviderFailure>
  /**
   * Opens the zip archive of the repository at a commit, refusing one announced as larger than `maxBytes`. The body
   * is streamed to storage by the caller, which also enforces the limit when no size is announced.
   */
  downloadArchive(source: ProviderSource, commit: string, maxBytes: number): Promise<{ body: ReadableStream<Uint8Array> } | ProviderFailure>
}
