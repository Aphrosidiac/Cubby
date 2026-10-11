/** An error meant for the person: the message is shown as-is in the UI / API / MCP. */
export class UserError extends Error {
  constructor(
    message: string,
    public code = 'bad_request'
  ) {
    super(message)
    this.name = 'UserError'
  }
}

/** A guardrail stopped the action. `rule` names which one (brand_lock, pacing, checkpoint, …). */
export class GuardrailError extends UserError {
  constructor(
    message: string,
    public rule: string
  ) {
    super(message, 'guardrail')
    this.name = 'GuardrailError'
  }
}

export const notFound = (what: string): UserError => new UserError(`${what} not found`, 'not_found')
