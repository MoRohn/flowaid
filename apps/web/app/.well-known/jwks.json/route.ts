import { proxy } from "~/server/proxy";

// Forwarded to the API at request time (src/server/proxy.ts).
export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
