export class KazumiRuleError extends Error {
  constructor(message, { code = 'RULE_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'KazumiRuleError';
    this.code = code;
  }
}
