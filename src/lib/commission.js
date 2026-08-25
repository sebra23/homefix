/**
 * Commission calculation — percentage with cap, no cliff
 * 5% of order value, capped at 5,000 SEK
 */
export function calculateCommission(orderValue) {
    if (!orderValue || orderValue <= 0) return 0;
    const rate = 0.05; // 5%
    const cap = 5000;  // SEK
    return Math.min(Math.round(orderValue * rate), cap);
}

/**
 * Display formatted commission for a given order value
 */
export function formatCommission(orderValue) {
    const commission = calculateCommission(orderValue);
    return `${commission.toLocaleString('sv-SE')} SEK`;
}
