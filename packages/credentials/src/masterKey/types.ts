/**
 * Master key providers wrap the key-encryption keys (KEKs). The master key itself never leaves
 * the provider for KMS/Vault; env and file providers hold it in memory. `kcv()` identifies the
 * master so a boot with the wrong key fails loudly (E_MASTER_KEY_MISMATCH) instead of producing
 * garbage.
 */
export type MasterProviderId = "env" | "file" | "aws-kms" | "vault-transit";

export interface MasterKeyProvider {
  readonly id: MasterProviderId;
  wrap(kek: Uint8Array): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
  /** Key check value of the master (see each provider for how it is derived). */
  kcv(): Promise<string>;
}
