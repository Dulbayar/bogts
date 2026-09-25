/**
 * Bonum webhook bodies, copied exactly from docs/providers/bonum-api.md
 * (decimals included). Two samples in the doc are not valid JSON as printed
 * (a `// SUCCESS | FAILED` comment, a trailing comma); `docJson` removes just
 * those, and says so, so the fixture text itself stays verbatim.
 */

/** "WebHook - Create Invoice (Successful)" */
export const PAYMENT_SUCCESS = `{
    "type": "PAYMENT",
    "status": "SUCCESS",
    "message": "",
    "body": {
        "amount": 10000.00,
        "currency": "MNT",
        "completedAt": "2026-01-29 11:20:33",
        "terminalId": "17171994",
        "invoiceId": "8eff7d69001c03f486f64410f9daa82c",
        "paymentVendor": "QPAY",
        "initType": "ECOMMERCE",
        "status": "PAID",
        "respCode": "",
        "transactionId": "N998921",
        "extras-inputs": [],
        "extras": []
    }
}`;

/** "WebHook - Create Invoice (Failed)" */
export const PAYMENT_FAILED = `{
    "type": "PAYMENT",
    "status": "FAILED",
    "message": "",
    "body": {
        "transactionId": "B347699",
        "amount": 15000.00,
        "currency": "MNT",
        "updatedAt": 1769657291559,
        "terminalId": "17171994",
        "invoiceStatus": "EXPIRED"
    }
}`;

/** "Create Card Token Web Hook Message", the request-body sample (valid JSON as printed). */
export const CARD_TOKEN_SUCCESS = `{
    "type":"CARD-TOKEN",
    "status":"SUCCESS",
    "message":"",
    "body":{
        "token":"<CARD-TOKEN-VALUE>",
        "mask":"5150 23** **** 4778",
        "expiry":"2026/11",
        "bank":{
            "id":19,
            "code":"150000",
            "name":"Голомт банк",
            "icon":"https://bonum-prod-resource.s3.us-east-2.amazonaws.com/golomt.png",
            "iBanCode":"0015",
            "transferCode":"GMT"
        },
        "transactionId":"<merchant transaction id>",
        "completedAt":"2026-01-26 12:58:03",
        "amounts":[
            {
                "amount":5.00,
                "currency":"MNT"
            }
        ],
        "subscriptions":[
            {
                "subscriptionId":1,
                "planId":1,
                "nextBillingDate":"2026-02-02 00:00:00"
            }
        ]
    }
}
`;

/** "Subscription Automatic Payment WebHook Messages" (has a `//` comment as printed). */
export const SUBSCRIPTION_PAYMENT = `{
    "type":"SUBSCRIPTION-PAYMENT",
    "status":"SUCCESS", // SUCCESS | FAILED
    "message":"",
    "body":{
        "subscriptionId":41,
        "invoiceId":786,
        "planId":4,
        "transactionId":"20000007", // merchant's transaction id for the subscription.
        "completedAt":"2026-01-27 02:00:08",
        "amount":3,
        "currency":"MNT"
    }
}`;

/** "Purchase Async WebHook" (has a `//` comment and a trailing comma as printed). */
export const TOKEN_PAYMENT = `{
    "type":"TOKEN-PAYMENT",
    "status":"SUCCESS", // SUCCESS | FAILED
    "message":"",
    "body":{
        "transactionId":"6ab20250512180511006",
        "completedAt":"2026-01-26 12:58:03",
    }
}`;

/**
 * NOT from the docs: Bonum's "[ Retry Exhausted ]" sample is empty. The shape
 * is assumed from the SUBSCRIPTION-PAYMENT message; confirm in the sandbox.
 */
export const UNSUBSCRIBED_ASSUMED = `{"type":"UNSUBSCRIBED","status":"SUCCESS","message":"","body":{"subscriptionId":41,"planId":4,"transactionId":"20000007","completedAt":"2026-01-30 02:00:08"}}`;

/** Makes a doc sample valid JSON: drops `//` line comments (outside strings) and trailing commas. */
export function docJson(text: string): string {
	return text
		.split('\n')
		.map((line) => line.replace(/,?\s*\/\/[^"]*$/, (m) => (m.startsWith(',') ? ',' : '')))
		.join('\n')
		.replace(/,(\s*[}\]])/g, '$1');
}

/** Replaces `"key":value` text in a sample, keeping everything else byte for byte. */
export function withField(text: string, key: string, value: string): string {
	const re = new RegExp(`("${key}"\\s*:\\s*)("[^"]*"|[^,\\n}\\]]+)`);
	if (!re.test(text)) throw new Error(`fixture has no ${key}`);
	return text.replace(re, `$1${value}`);
}
