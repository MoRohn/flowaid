/**
 * AWS's published SigV4 test suite (aws-sig-v4-test-suite): credentials AKIDEXAMPLE, region
 * us-east-1, service `service`, 2015-08-30T12:36:00Z. Each expected value is the vector's `.authz`.
 */
import { describe, expect, it } from "vitest";
import { signAwsRequest } from "./sigv4.js";

const CREDENTIALS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const DATE = new Date("2015-08-30T12:36:00Z");
const CRED = "AKIDEXAMPLE/20150830/us-east-1/service/aws4_request";

const sign = (
  method: string,
  url: string,
  extra: { headers?: Record<string, string>; body?: string; sessionToken?: string } = {},
) =>
  signAwsRequest({
    method,
    url: new URL(url),
    region: "us-east-1",
    service: "service",
    credentials: extra.sessionToken
      ? { ...CREDENTIALS, sessionToken: extra.sessionToken }
      : CREDENTIALS,
    date: DATE,
    ...(extra.headers ? { headers: extra.headers } : {}),
    ...(extra.body !== undefined ? { body: extra.body } : {}),
  }).authorization;

describe("SigV4 (aws-sig-v4-test-suite)", () => {
  it("get-vanilla", () => {
    expect(sign("GET", "https://example.amazonaws.com/")).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31`,
    );
  });

  it("post-vanilla", () => {
    expect(sign("POST", "https://example.amazonaws.com/")).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b`,
    );
  });

  it("get-vanilla-query-order-key-case", () => {
    expect(sign("GET", "https://example.amazonaws.com/?Param2=value2&Param1=value1")).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500`,
    );
  });

  it("get-vanilla-query-unreserved", () => {
    const u = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    expect(sign("GET", `https://example.amazonaws.com/?${u}=${u}`)).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=host;x-amz-date, Signature=9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197`,
    );
  });

  it("get-header-value-trim", () => {
    expect(
      sign("GET", "https://example.amazonaws.com/", {
        headers: { "My-Header1": " value1", "My-Header2": ' "a   b   c"' },
      }),
    ).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=host;my-header1;my-header2;x-amz-date, Signature=acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736`,
    );
  });

  it("post-x-www-form-urlencoded", () => {
    expect(
      sign("POST", "https://example.amazonaws.com/", {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "Param1=value1",
      }),
    ).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a`,
    );
  });

  it("post-sts-header-before (the session token is signed)", () => {
    const token =
      "AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA==";
    expect(sign("POST", "https://example.amazonaws.com/", { sessionToken: token })).toBe(
      `AWS4-HMAC-SHA256 Credential=${CRED}, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead`,
    );
  });

  it("returns the headers it signed, lowercased", () => {
    const h = signAwsRequest({
      method: "POST",
      url: new URL("https://kms.eu-west-1.amazonaws.com/"),
      region: "eu-west-1",
      service: "kms",
      credentials: { ...CREDENTIALS, sessionToken: "tok" },
      headers: { "X-Amz-Target": "TrentService.Encrypt" },
      date: DATE,
    });
    expect(h).toMatchObject({
      host: "kms.eu-west-1.amazonaws.com",
      "x-amz-date": "20150830T123600Z",
      "x-amz-security-token": "tok",
      "x-amz-target": "TrentService.Encrypt",
    });
    expect(h.authorization).toContain("/20150830/eu-west-1/kms/aws4_request");
  });
});
