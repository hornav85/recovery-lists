import assert from "node:assert/strict";
import { isDialablePhone, normalizePhone, telHref } from "./phone";

assert.equal(normalizePhone("(305) 555-0101"), "+13055550101");
assert.equal(normalizePhone("305-555-0101"), "+13055550101");
assert.equal(normalizePhone("305.555.0101"), "+13055550101");
assert.equal(normalizePhone("305/555/0101"), "+13055550101");
assert.equal(normalizePhone("3055550101"), "+13055550101");
assert.equal(normalizePhone("  8135550303  "), "+18135550303");
assert.equal(normalizePhone("13055550101"), "+13055550101");
assert.equal(normalizePhone("1 (305) 555-0101"), "+13055550101");
assert.equal(normalizePhone("+1 305 555 0101"), "+13055550101");
assert.equal(normalizePhone("+1-305-555-0101"), "+13055550101");
assert.equal(normalizePhone("+13055550101"), "+13055550101");

assert.equal(normalizePhone(null), null);
assert.equal(normalizePhone(undefined), null);
assert.equal(normalizePhone(""), null);
assert.equal(normalizePhone("   "), null);

assert.equal(normalizePhone("abc"), "abc");
assert.equal(normalizePhone("call 3055550101"), "call 3055550101");
assert.equal(normalizePhone("3055550101 ext 9"), "3055550101 ext 9");
assert.equal(normalizePhone("555-0101"), "555-0101");
assert.equal(normalizePhone("813555030"), "813555030");
assert.equal(normalizePhone("28135550303"), "28135550303");
assert.equal(normalizePhone("181355503033"), "181355503033");
assert.equal(normalizePhone("  not a phone  "), "  not a phone  ");

assert.equal(telHref("(813) 555-0303"), "tel:+18135550303");
assert.equal(telHref("+18135550303"), "tel:+18135550303");
assert.equal(telHref("nope"), null);
assert.equal(telHref(null), null);
assert.equal(telHref("555-0101"), null);
assert.equal(isDialablePhone("+18135550303"), true);
assert.equal(isDialablePhone("8135550303"), false);
assert.equal(isDialablePhone("+1813555030"), false);

console.log("phone tests ok");
