// The Gift Aid declaration wording, by version.
//
// Config rather than Keystatic, deliberately (spec/gift-aid/01). This is a legal
// declaration, not page copy: every stored declaration records the version it was
// made under, and Keystatic would let anyone with CMS access change the words
// without changing the version -- which silently makes every past record claim
// the donor agreed to something they never saw.
//
// To change the wording: add `v2` below, point DECLARATION_VERSION at it, and bump
// Settings -> "Declaration wording version" in the bookkeeper's sheet. Never edit
// or remove an existing version; stored declarations point at it.

export const CHARITY_NAME = 'Dartington Recreation Association';
export const CHARITY_NUMBER = '1168817';

export type Scope = 'Single' | 'Enduring';

interface Wording {
  /** `{amount}` is replaced by "my donation of £25" or, with no amount, "my donation". */
  Enduring: string;
  Single: string;
}

const TAX_SENTENCE = 'I am a UK taxpayer and understand that if I pay less Income Tax and/or '
  + 'Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year '
  + 'it is my responsibility to pay any difference.';

export const DECLARATIONS: Record<string, Wording> = {
  v1: {
    // Exactly as supplied by the DRA. Pinned word for word by a test.
    Enduring: `I want to Gift Aid {amount} and any donations I make in the future or have made `
      + `in the past 4 years to ${CHARITY_NAME}. ${TAX_SENTENCE}`,
    // HMRC's model single-donation wording: the same sentence without the
    // past-and-future clause, which would contradict a donor who chose "this
    // donation only". See open question 1 in the spec.
    Single: `I want to Gift Aid {amount} to ${CHARITY_NAME}. ${TAX_SENTENCE}`,
  },
};

export const DECLARATION_VERSION = 'v1';

/** Shown under the declaration everywhere, and repeated in every confirmation email. */
export const UPDATE_NOTICE = 'Please let us know if you want to cancel this declaration, change '
  + 'your name or home address, or no longer pay enough Income Tax and/or Capital Gains Tax.';

export const BOOST_HEADLINE = 'Boost your donation by 25p of Gift Aid for every £1 you donate';

export const NOT_A_TAXPAYER = 'Not a UK taxpayer? Please leave this unticked. Gift Aid can only be '
  + 'claimed on tax you have paid in the UK. Your donation is just as welcome without it.';

export const CONTACT_EMAIL = 'contact@meadowbrookdartington.org';

/** £25, £25.50. Integer pence in, never a float. */
export function formatPounds(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rem = pence % 100;
  return rem === 0 ? `£${whole}` : `£${whole}.${String(rem).padStart(2, '0')}`;
}

/** The sentence as the donor sees it, which is also what gets stored. */
export function renderDeclaration(
  scope: Scope, amountPence: number | null, version = DECLARATION_VERSION,
): string {
  const wording = DECLARATIONS[version];
  if (!wording) throw new Error(`Unknown declaration version ${version}`);
  const amount = amountPence && amountPence > 0
    ? `my donation of ${formatPounds(amountPence)}`
    : 'my donation';
  return wording[scope].replace('{amount}', amount);
}

/** 25p per £1, rounded down: never promise a donor more than HMRC will pay. */
export const giftAidOn = (pence: number): number => Math.floor(pence / 4);
