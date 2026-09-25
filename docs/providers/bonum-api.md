# Bonum Gateway APIs

<html><head></head><body><p>Variables:<br>[ Testing Env ]</p>
<p>{{ API_BASE_URL }} : <a href="https://testapi.bonum.mn">https://testapi.bonum.mn</a></p>
<p>{{ APP_SECRET }}: 1fc53f9389f489ff6e04617bd6338a710e1e7c579cb572aec421f560f363119c0e0039e4b765e53c5339c1e6c77279854b20e998ed4599983a9c9dba12b36e89ce7ee7659043ebffcf77a095587bf694</p>
<p>{{ DEFAULT_TERMINAL_ID }}: 17171119</p>
<p>{{ MERCHANT_CHECKSUM_KEY }} : 755753df1f8fb16da1131cc318f1bcec9b5df3e39ae5dee902900cd186e7ece8</p>
<hr>
<p>[ Prod Env ]</p>
<p>{{ API_BASE_URL }} : <a href="https://testapi.bonum.mn">https://apis.bonum.mn</a></p>
<p>{{ APP_SECRET }}: Ask Bonum</p>
<p>{{ DEFAULT_TERMINAL_ID }} : Ask Bonum</p>
<hr>
<p>Localization:</p>
<p>Language:<br>Accept-Language: mn | en</p>
<p>use this header to all requestes to get back localized message.</p>
<hr>
</body></html>


## Authentication



### Get token
`GET {{API_BASE_URL}}/bonum-gateway/ecommerce/auth/create`

Headers: Authorization: AppSecret {{APP_SECRET}}, X-TERMINAL-ID: {{DEFAULT_TERMINAL_ID}}, : 

<ul>
<li><p>{{ APP_SECRET }}: It is created on the merchant portal</p>
</li>
<li><p>{{ DEFAULT_TERMINAL_ID }}: create a terminal on merchant portal and use the terminalId value for this variable</p>
</li>
</ul>
<p>Caution:<br />This endpoint is protected by rate limiting. Excessive or too frequent requests will result in a <strong><code>TOO_MANY_REQUESTS</code></strong> error.</p>


Example response (TOO_MANY_REQUEST: Rate Limit Response, 429):
```
{
    "traceId": "695cbcbce9d3faa6d491a7a08b388972",
    "errorCode": null,
    "error": null,
    "message": "Rate-Limit: Use previous token. Do not get token too frequently,",
    "data": null,
    "detail": null,
    "duration": 452,
    "status": 429
}
```

Example response (Get token Success, 200):
```
{
    "tokenType": "Bearer",
    "accessToken": "bla bla",
    "expiresIn": 1800,
    "refreshToken": "bla bla",
    "refreshExpiresIn": 2000,
    "unit": "SECONDS"
}
```

### Refresh token
`GET {{API_BASE_URL}}/bonum-gateway/ecommerce/auth/refresh`



## Web payment / All in one



### Get Payment Providers
`GET {{API_BASE_URL}}/bonum-gateway/ecommerce/invoices/payment-providers`

<p>This returns the active payment options that can be used for your customers.</p>
<p>This list can be added/modified.</p>
<p>for example:</p>
<ul>
<li><p>QPAY: QR based payment, every bank, and fin-tech apps supports QPAY payment</p>
</li>
<li><p>E_COMMERCE: Online Card Payment</p>
</li>
<li><p>WE_CHAT: Chinese customers can use their WeChat wallet app to pay the payment.</p>
</li>
<li><p>SONO_SHOP: Buy now, Pay Later. Customer can pay the payment with SonoShop.s loan.</p>
</li>
</ul>


Example response (Get Payment Providers, 200):
```
[
    {
        "provider": "QPAY",
        "enabled": true
    },
    {
        "provider": "E_COMMERCE",
        "enabled": true
    },
    {
        "provider": "SONO_SHOP",
        "enabled": true
    }
]
```

### Create Invoice
`POST {{API_BASE_URL}}/bonum-gateway/ecommerce/invoices`

Headers: Accept-Language: mn

<ol>
<li><p>It creates an invoice and returns a follow-up link for the invoice.</p>
</li>
<li><p>the browser or client must be redirected the follow-up link for customer to proceed the payment</p>
</li>
<li><p>Once, the payment is completed successfully or cancelled, A notification will be sent to the <strong>WebHook</strong></p>
</li>
</ol>
<p><strong>NOTE:</strong></p>
<p><strong>WebHook</strong> is a http(s) endpoint that our backend sends a notification to by using <strong>POST</strong> method when the user payment is done or cancelled.</p>
<p><strong>WebHook</strong> must be provided from your side and pre-configured or pre-defined on our side, Merchant-Portal (<a href="https://merchant.bonum.mn">https://merchant.bonum.mn</a>)</p>
<p>For more information about <strong>WebHook, "WebHook delievery"</strong> folder include webbook specs and samples.</p>
<p>POST body:</p>
<ol>
<li><p><strong>"amount"</strong> is payment amount value</p>
</li>
<li><p><strong>"callback"</strong> is URL that browser or client redirects to once the payment process is done.</p>
</li>
<li><p><strong>"transactionId"</strong> is unique id for every invoice. Once the payment is done, the <strong>WebHook</strong> message will include this field.</p>
</li>
<li><p><strong>"expiresIn"</strong> is invoice ttl duration in seconds. Once this time is up, the invoice is in EXPIRED status, and the browser redirects to the callback</p>
</li>
<li><p><strong>"providers"</strong> is an optional array field used to restrict the available payment methods displayed on the Bonum checkout page. For example: "providers": ["QPAY", "WE_CHAT"]</p>
</li>
<li><p><strong>"items"</strong> is optional array field used to show additional information on the payment checkout page.</p>
</li>
<li><p><strong>"extras"</strong> is an optional array field used to collect additional payment-related information from the customer.</p>
</li>
</ol>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "amount" : 1,
    "callback" : "",
    "transactionId" : "a123456789", // len (min = 1, max = 80)
    "expiresIn": 23000,  // seconds
    "providers" : ["QPAY"], // optional, QPAY, WE_CHAT, SONO_SHOP, E_COMMERCE  see "Get Payment Providers"
    "items" : [ // optional
        {
            "image" : "https://mchat-test-resource.s3.amazonaws.com/merch_img_11_67107315ad5f5adcabe59b433ea363cfpng",
            "title" : "Test 1",
            "remark" : "Test Remark 1",
            "amount" : 1,
            "count" : 1
        }
    ],
    "extras" : [ //optional
        {
            "placeholder" : "jordan24",
            "type" : "TEXT", // NUMBER,PHONE,EMAIL,TEXT, ALL,
            "required" : true
        }
    ]
}

</code></pre>


Request body:
```
{
    "amount" : 1,
    "callback" : "",
    "transactionId" : "a1a123456789", //"9087654322",
    "expiresIn": 23000,  // seconds
    //"providers" : ["QPAY"], // optional, QPAY,  see "Get Payment Providers"
    "items" : [ // optional
        {
            "image" : "https://mchat-test-resource.s3.amazonaws.com/merch_img_11_67107315ad5f5adcabe59b433ea363cfpng",
            "title" : "Test 1",
            "remark" : "Test Remark 1",
            "amount" : 1,
            "count" : 1
        }
    ],
    "extras" : [ //optional
        {
            "placeholder" : "jordan24",
            "type" : "TEXT", // NUMBER,PHONE,EMAIL,TEXT, ALL,
            "required" : true
        }
    ]
}
```

Example response (Create Invoice, 200):
```
{
    "invoiceId": "8cf2c49d200f049f2b384f0adf42b981c141b6f269a137ea9616ea93e80c9d4d",
    "followUpLink": "https://ecommerce.bonum.mn/ecommerce?invoiceId=c511ea63fbc08e8ea2ca6879b07bf764"
}
```

### Get Invoice Status (Testing)
`GET {{API_BASE_URL}}/bonum-gateway/ecommerce/invoices/22c4f07f9e198b3953dd1fbc7b240af6904bcb221ce1f1b79c57f4812a3ce38e`

Headers: Accept: application/json

<p>This service returns the payment status created by the service "Create Invoice"</p>
<p>CAUTION: DO NOT USE THIS SERVICE ON PRODUCTION.</p>
<p>- To check invoice status, use your local data and webhook message delievery: Invoice record is stored on your side, and once a webhook is received, update the invoice row.</p>


### Set Invoice To Paid Status (Testing)
`GET {{API_BASE_URL}}/bonum-gateway/ecommerce/invoices/paid?invoiceId=22c4f07f9e198b3953dd1fbc7b240af6c2529c16437df58e54acfccf1278c98a`

<ol>
<li><p>It creates an invoice and returns a follow-up link for the invoice.</p>
</li>
<li><p>the browser or client must be redirected the follow-up link for the user to proceed the payment</p>
</li>
<li><p>Once, the payment is completed successfully or cancelled, A notification will be sent to the callback</p>
</li>
</ol>
<p><strong>callback</strong> is a http(s) endpoint that our backend sends a notification to by using <strong>POST</strong> method when the user payment is done or cancelled.</p>
<p><strong>callback</strong> must be provided from your side and pre-configured or pre-defined on our side</p>
<p>POST body:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "type" : "PAYMENT",
    "status" : "SUCCESS", // "FAILED"
    "body" : {
        "amount" : 100,
        "transactionId" : "abs12345678909876544321",
        "invoiceId" : "321"
    }
}

</code></pre>


Request body:
```
{
    "amount" : 100,
    "transactionId" : "abs12345678909876544321"
}
```

### WebHook - Create Invoice
`GET `

<p>Once after user completes the payment, the webhook message will be sent to the merchant's registered webhook.</p>
<p>See the examples for detail</p>


Example response (WebHook - Create Invoice (Successful), None):
```
{
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
}
```

Example response (WebHook - Create Invoice (Failed), None):
```
{
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
}
```

## Card Tokenization

<p>Request Headers:</p>
<p>X-CARD-TOKEN: must be attached to request header, its value is sent to the 3rd party's webhook endpoint once credit card token is generated successfully</p>


### Create Card Token
`POST {{API_BASE_URL}}/mpay-service/merchant/cards/tokenize/request`

Headers: Accept-Language: mn

<p>It creates credit card tokenization request and returns a follow-up link.</p>
<p>the follow-up link will take the user throgth steps necessary. once the process is done and token is generated, "webhook" (server-to-server) notification (http-post) will be sent the merchant's webhook url which is registered in the merchat portal site</p>
<ul>
<li><p><strong>"callback"</strong> is the 3rd party's url, user browser will be redirected to this after tokenization process is done.</p>
</li>
<li><p><strong>"transactionId"</strong> is the 3rd party's unique id for the tokenization request, it will be attached to the tokenization process and will be sent to the 3rd party's web-hook url with the customer credit card token.</p>
</li>
<li><p><strong>"payment"</strong> is an optional field, when actual payment transaction and token is processed, you can use <strong>payment.amount</strong> field. if no payment.amout is passed, <strong>0.01 MNT</strong> will be processed for verfication.</p>
</li>
<li><p><strong>"subscription"</strong> is optional, if set, the card token is SUBSCRIBED to the payment plan</p>
<ul>
<li><p><strong>"planId"</strong> merchant's payment plan Id, can be found "List of Payment Plans" service.</p>
</li>
<li><p><strong>"cycleValue"</strong> possible values based on the given plan</p>
<ul>
<li><p>1 - 7 for WEEKLY plan, 1-Mon, ... 7-Sun</p>
</li>
<li><p>1 - 31 for MONTHLY plan</p>
</li>
<li><p>1 - 366 for YEARLY plan</p>
</li>
</ul>
</li>
<li><p><strong>"cycles"</strong> is optional, how many cycles the subscription runs for. If no value to this, the subscription will be active for good. For example: cycles=10, it means the subscription will be active for 10 cycles. If cycles=null, the subscription will be active until the cancellation request is issued.</p>
</li>
<li><p><strong>"payNow"</strong> if true, "cycleValue" will be ignored, the current date becomes the first billing date, and the next billing date will be calculated with payment plan's recurring type on the current date.</p>
</li>
<li><p><strong>"custEmail"</strong> is optional, subsription payment notification will be sent to this email.</p>
</li>
</ul>
</li>
<li><p><strong>"items"</strong> is optinal.</p>
<ul>
<li><p><strong>"image"</strong> item's image url shown on the hosted page.</p>
</li>
<li><p><strong>"title"</strong> item's title shown on the hosted page.</p>
</li>
</ul>
</li>
</ul>
<p><strong>NOTE:</strong> If subscription date is the same day of payment plan's cycleValue, then payment transaction is processed upon the subscription. For example: Let take a monthly payment plan, its cycleValue is 1 which means the first day of every month, payment is processed automatically, and if a user subscribes to it on the first day of a month, the payment is immediately processed during the subscription.</p>


Request body:
```
{
    "callback" : "https://merchant-web/card-token-callback?id=20250512180511001",
    "transactionId" : "24za20250512180511006",

    "payment" : { 
        "amount" : 10.00
    },

    "subscription1" : { 
        "planId" : 1,
        "cycleValue" : "5",
        "cycles" : 5, 
        "payNow" : false, 
        "custEmail" : "test@gmail.com"
    },

    "items" : [
        {
            "image" : "https://www.google.com",
            "title" : "Item 6 title",
            "remark" : "Item 6 remark",
            "amount" : 1,
            "count" : 10
        }
    ]
}
```

Example response (Create Card Token, 200):
```
{
    "followUpLink": "https://ecommerce.bonum.mn/tokenize?id=73c642ec1df9cabe7fd7d4a2777f4ff18989a79321cea0dbca83bb7aa2d5886b",
    "id": "73c642ec1df9cabe7fd7d4a2777f4ff18989a79321cea0dbca83bb7aa2d5886b"
}
```

Example response (Create Card Token + Payment Processing, 200):
```
{
    "followUpLink": "https://testecommerce.bonum.mn/tokenize?id=1fc53f9389f489ff6e04617bd6338a71aef036232a34a77fc92a1a748f40a8c7",
    "id": "1fc53f9389f489ff6e04617bd6338a71aef036232a34a77fc92a1a748f40a8c7"
}
```

### Create Card Token Web Hook Message
`POST `

<p>On a successful card token generation, a webhook message will be sent the merchant's registered webhook message.</p>
<p>Webhook message fields:</p>
<ul>
<li><p><strong>"token"</strong> card token string.</p>
</li>
<li><p><strong>"mask"</strong> masked card number</p>
</li>
<li><p><strong>"expiry"</strong> card's expire month</p>
</li>
<li><p><strong>"bank"</strong> card's issuer bank</p>
</li>
<li><p><strong>"transactionId"</strong> merchant's transaction id used in "Card Create Token" request body</p>
</li>
<li><p><strong>"amounts"</strong> дүнтэй, эсвэл subscription.тай үед төлбөрийн дүн</p>
</li>
<li><p><strong>"subscriptions"</strong> payment plan руу subscribe хийсэн бол subscription.ны id</p>
</li>
</ul>
<p>Webhook message body:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "type":"CARD-TOKEN",
    "status":"SUCCESS",
    "message":"",
    "body":{
        "token":"1fc53f9389f489ff6e04617bd6338a710e1e7c579cb572aec421f560f363119c45de074278126f4e9adbc626cccba687513731bc9f8cd1737efed3e58d30dfb9",
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
        "transactionId":"6ab20250512180511006",
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
                "nextBillingDate":"2026-02-02 00:00:00",
            }
        ]
    }
}

</code></pre>


Request body:
```
{
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

```

### Purchase
`POST {{API_BASE_URL}}/mpay-service/merchant/transaction/purchase`

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345, Accept-Language: mn

<p><strong>Make a Payment Using a Card Token</strong></p>
<p>This endpoint initiates a payment using a previously generated card token.</p>
<p><strong>Note:</strong></p>
<p>During periods of high traffic, payment requests may be placed into a processing queue. Queued payments will be executed asynchronously, and the final result will be delivered to the merchant’s configured webhook endpoint.</p>
<p><strong>Caution:</strong></p>
<p>Do <strong>not</strong> rely on or expose the <code>response["errorCode"]</code> field. This field is intended for internal use only.</p>
<p><strong>Additional Information:</strong><br />For detailed behavior and possible outcomes, refer to the sample request and response examples</p>


Request body:
```
{
    "amount" : 15,
    "currency" : "MNT",
    "transactionId" : "" // transactionid
}
```

Example response (Амжилттай гүйлгээ, 200):
```
{

    "traceId":"6965c23f4a88878d6f11b97bd0dc4f57",
    "errorCode":"${invalid.bonum.response.00}",
    "error":null,
    "message":"Төлбөр амжилттай хийгдлээ (00)",
    "data":{
        "id":172345,
        "completedAt":"2026-01-13 11:55:44",
        "status":"SUCCESS",
        "description":"",
        "cardStatus":"ACTIVE"
    },
    "detail":null,
    "duration":759,
    "status":200

}
```

Example response (Үлдэгдэл хүрэлцэхгүй, None):
```
None
```

Example response (Purchase, 400):
```
{

    "traceId":"6965b3f57a560ad2d5d7dcd0bccedcfe",
    "errorCode":"${invalid.bonum.response.56}",
    "error":null,
    "message":"Картаар төлбөр хийх боломжгүй (56)",
    "data":{
        "id":171044,
        "completedAt":"2026-01-13 10:54:46",
        "status":"FAILED",
        "description":"",
        "cardStatus":"INACTIVE"
    },
    "detail":null,
    "duration":635,
    "status":400

}
```

Example response (Async Гүйлгээ, 201):
```
{

    "traceId":"697088018770d01b18064d81cef5f504",
    "errorCode":"QUEUED",
    "error":null,
    "message":"bonum.token.invoice.queued",
    "data":{
        "id":662,
        "completedAt":"2026-01-21 16:02:10",
        "status":"QUEUED",
        "description":"",
        "cardStatus":null,
        "respCode":null
    },
    "detail":null,
    "duration":1192,
    "status":201

}
```

### Purchase Async WebHook
`GET `

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345, Accept-Language: mn

<p>When purchase is queued, and completed the payment asyncronously, this webhook message will be sent</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "type":"TOKEN-PAYMENT",
    "status":"SUCCESS", // SUCCESS | FAILED
    "message":"",
    "body":{
        "transactionId":"6ab20250512180511006",
        "completedAt":"2026-01-26 12:58:03",
    }
}

</code></pre>


Request body:
```
{
    "amount" : 15,
    "currency" : "MNT",
    "transactionId" : "" // transactionid
}
```

### Rollback Purchase
`DELETE {{API_BASE_URL}}/mpay-service/merchant/transaction/reverse/:transactionId`

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345

<p>this service tries to reverse a token payment.</p>
<ul>
<li>transactionId pathvariable is the merchant's transactionid value.</li>
</ul>


## Subscription plans



### List Of Payment Plans
`GET {{API_BASE_URL}}/mpay-service/merchant/values/payment-plans`

<ol>
<li><p>It returns the list of payment plans (subscription plans) of the merchant.</p>
</li>
<li><p>Payment plan can be CRUD on merchant portal web</p>
</li>
</ol>


Example response (List Of Payment Plans, None):
```
{
    "traceId": "6960b2d3ec9f9d4a44caf66d5b4a5d26",
    "errorCode": null,
    "error": null,
    "message": null,
    "data": [
        {
            "planId": 1,
            "name": "Test Weekly Plan 1_prod",
            "remark": "Remark Test Weekly Plan 1_prod",
            "createdAt": "2025-03-20 15:53:51",
            "recurringType": "WEEKLY",
            "amount": 5.00,
            "status": "ACTIVE",
            "cardCount": 0,
            "retryCount": 3
        },
        {
            "planId": 21,
            "name": "Monthly",
            "remark": "Monhtly Plan",
            "createdAt": "2026-01-08 16:21:30",
            "recurringType": "MONTHLY",
            "amount": 9.00,
            "status": "ACTIVE",
            "cardCount": 0,
            "retryCount": 3
        }
    ],
    "detail": null,
    "duration": 686,
    "status": 200
}
```

### Subscribe
`POST {{API_BASE_URL}}/mpay-service/merchant/subscriptions/subscribe`

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345

<p>This service subscribes a credit card token to a payment plan, specified "planId" field in the request body</p>
<ul>
<li><p><strong>"planId"</strong> merchant's payment plan Id, can be found "List of Payment Plans" service.</p>
</li>
<li><p><strong>"cycleValue"</strong> possible values based on the given plan</p>
<ul>
<li><p>1 - 7 for WEEKLY plan, 1-Mon, ... 7-Sun</p>
</li>
<li><p>1 - 31 for MONTHLY plan</p>
</li>
<li><p>1 - 366 for YEARLY plan</p>
</li>
</ul>
</li>
<li><p><strong>"cycles"</strong> is optional, how many cycles the subscription runs for. If no value to this, the subscription will be active for good. For example: cycles=10, it means the subscription will be active for 10 cycles. If cycles=null, the subscription will be active until the cancellation request is issued.</p>
</li>
<li><p><strong>"payNow"</strong> if true, "cycleValue" will be ignored, the current data becomes the first billing date, and the next billing date will be calculated with payment plan's recurring type on the current date.</p>
</li>
<li><p><strong>"custEmail"</strong> is optional, subsription payment notification will be sent to this email.</p>
</li>
</ul>
<p><strong>NOTE:</strong> If subscription date is the same day of payment plan's cycleValue, then payment transaction is processed upon the subscription. For example: Lets take a monthly payment plan with cycleValue = 1 (the first day of every month), payment is processed automatically, and if a user subscribes to it on the first day of a month, the payment will be processed immediately during the subscription.</p>


Request body:
```
{
    "planId" : 30,
    "cycleValue" : 10,
    "cycles" : 3, 
    "payNow" : false,
    "custEmail" : "1234"
}
```

Example response (Multiple Subscription For same card, 429):
```
// if one subscription process is not finished, another subscription for a same card is issued
{
    "traceId": "6960ba5dc45779dd37aa757ea2535590",
    "errorCode": null,
    "error": null,
    "message": "subscription.process.waiting",
    "data": null,
    "detail": null,
    "duration": 4035,
    "status": 429
}
```

Example response (Card Payment Denied, 400):
```
// card system denies the payment request
{
    "traceId": "6960bb4080c62f8734d5c04ac3a97eec",
    "errorCode": "${invalid.bonum.response.89}",
    "error": null,
    "message": "Төлбөрийг гүйцэтгэх боломжгүй (89)",
    "data": null,
    "detail": null,
    "duration": 8664,
    "status": 400
}
```

Example response (Subscribe, 200):
```
{
    "traceId": "6976ca6cbdfca1fc116f23fe77eb024f",
    "errorCode": null,
    "error": null,
    "message": "",
    "data": {
        "subscriptionId": 41,
        "subscribedAt": "2026-01-26 09:59:11",
        "cardMask": "9496 43** **** 2727",
        "plan": {
            "planId": 4,
            "name": "Monthly Last Day Test v1",
            "remark": "Monthly Last Day Test v1",
            "createdAt": "2025-03-27 11:58:28",
            "recurringType": "MONTHLY",
            "amount": 3,
            "status": "ACTIVE",
            "cardCount": 0,
            "retryCount": 3
        },
        "nextBillAt": "2026-01-27 00:00:00",
        "lastBilledAt": "2026-01-26 09:59:11",
        "status": "ACTIVE"
    },
    "detail": null,
    "duration": 4594,
    "status": 201
}
```

### Change Subscription Token ( Create New Token )
`PUT {{API_BASE_URL}}/mpay-service/merchant/subscriptions/:subscriptionId/change/create-new-token`

<p>It subscribes the credit card token to the payment plan</p>
<ul>
<li>"planId" must be valid and created</li>
</ul>


Request body:
```
{
    "callback" : "https://merchant-web/card-token-callback?id=something",
    "transactionId" : "123456000",
    "items" : [ //(optional)
        {
            "image" : "https://www.google.com",
            "title" : "Item 8 title",
            "remark" : "Item 8 remark",
            "amount" : 1,
            "count" : 10
        }
    ]
}
```

### Change Subscription Token (Existing Token)
`PUT {{API_BASE_URL}}/mpay-service/merchant/subscriptions/:subscriptionId/change`

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345

<p>It subscribes the credit card token to the payment plan</p>
<ul>
<li>"planId" must be valid and created</li>
</ul>


### Get Subscriptions
`GET {{API_BASE_URL}}/mpay-service/merchant/subscriptions`

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345

<p>It returns the subscriptions of the credit card token</p>


### Unsubscribe
`DELETE {{API_BASE_URL}}/mpay-service/merchant/subscriptions/:subscriptionId`

<p>It deletes the subscription of the credit card token from a payment plan</p>
<ul>
<li>the next billing cycle payment will be executed at the next billing date</li>
</ul>


Request body:
```
{
    "planId" : ""
}
```

### Delete Subscription
`DELETE {{API_BASE_URL}}/mpay-service/merchant/subscriptions/:subscriptionId/delete`

<p>It deletes the subscription of the credit card token from a payment plan</p>
<ul>
<li>no payment is created for the next billing cycle</li>
</ul>


Request body:
```
{
    "planId" : ""
}
```

### Request a card token
`POST `

<p>It sends the card token, which was created with "transactionId" by the service "Create Card Token", to the merchant's web-hook</p>
<ul>
<li>"transactionId" must be valid and assigned to a card token</li>
</ul>


### Subscription Automatic Payment WebHook Messages
`POST `

<p>Once card token is subscribed to a Payment plan. The payment process will be issued automatically on the billing date according to the payment plan's recurring type,<br />Then sends a webhook message to merchant's registered webhook url.</p>
<p>WebHook Message Body:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
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
}

</code></pre>


Example response ([ Success ] Subscription Automatic Payment WebHook Message, None):
```

```

Example response ([ Failed ] Subscription Automatic Payment WebHook Message, None):
```

```

Example response ([ Retry Exhausted ] Subscription Automatic Payment WebHook Message, None):
```

```

### [ TEST ] Execute A Subscription Payment
`PUT {{API_BASE_URL}}/mpay-service/merchant/subscriptions/:subscriptionId/execute`

<p>Use this service on SANDBOX environment to test subscription payment and expiration</p>


## QR code, Deeplink payment



### Create Qr Code
`POST {{API_BASE_URL}}/mpay-service/merchant/transaction/qr/create`

<p>Gets QR Invoice by qrCode (Qpay QrCode)</p>


Request body:
```
{
    "amount" : 10,
    "transactionId" : "3ba1234567890a",
    "expiresIn" : 600 // 10 minutes
}
```

Example response (Create Qr Code, None):
```
{
    "traceId": "69b76ea35599c03cb4fdfa4c12a2d9c6"
    "duration": 559,
    "error": null,
    "errorCode": null,
    "message": null,
    "status": 200,
    "data": {
        "invoiceId" : "1234bacd123",
        "qrCode" : "12345...abc",
        "qrImage" : "[base64]",
        "links": [
            {
                "name": "Khan bank",
                "description": "Хаан банк",
                "logo": "https://qpay.mn/q/logo/khanbank.png",
                "link": "khanbank://q?qPay_QRcode=0002010102121531279404962794049600260311650482827540014A00000084300010108CAXBMNUB022080t03dDu6zrZUZpn8NRr520473995303496540125802MN5912POSTMERCHANT6011ULAANBAATAR6224072080t03dDu6zrZUZpn8NRr7106QPP_QR78152423543826589397902358002016304D802",
                "appStoreId": "1555908766",
                "androidPackageName": "com.khanbank.retail"
            },
            {
                "name": "Social Pay",
                "description": "Голомт банк",
                "logo": "https://qpay.mn/q/logo/socialpay.png",
                "link": "socialpay-payment://q?qPay_QRcode=0002010102121531279404962794049600260311650482827540014A00000084300010108CAXBMNUB022080t03dDu6zrZUZpn8NRr520473995303496540125802MN5912POSTMERCHANT6011ULAANBAATAR6224072080t03dDu6zrZUZpn8NRr7106QPP_QR78152423543826589397902358002016304D802",
                "appStoreId": "1152919460",
                "androidPackageName": "mn.egolomt.socialpay"
            },
            {
                "name": "Trade and Development bank",
                "description": "TDB online",
                "logo": "https://qpay.mn/q/logo/tdbbank.png",
                "link": "tdbbank://q?qPay_QRcode=0002010102121531279404962794049600260311650482827540014A00000084300010108CAXBMNUB022080t03dDu6zrZUZpn8NRr520473995303496540125802MN5912POSTMERCHANT6011ULAANBAATAR6224072080t03dDu6zrZUZpn8NRr7106QPP_QR78152423543826589397902358002016304D802",
                "appStoreId": "1458831706",
                "androidPackageName": "mn.tdb.pay"
            }
        ]
    }
}
```

### Invoice By Qr Code
`POST {{API_BASE_URL}}/mpay-service/merchant/transaction/qr`

<p>Gets QR Invoice by qrCode (Qpay QrCode)</p>


Request body:
```
{
    "qrCode" : "0002010102121531279404962794049600251010000110727540014A00000084300010108CAXBMNUB02204hDYWJR5rqW11V1qlrtX520460115303496540115802MN5912POSTMERCHANT6011ULAANBAATAR622407204hDYWJR5rqW11V1qlrtX7106QPP_QR781505693975190775979023580020163047991"
}
```

### Pay By Card Token
`PUT {{TOKEN_BASE_URL}}/merchant/transaction/qr/pay`

Headers: X-CARD-TOKEN: 1fc53f9389f489ff6e04617bd6338a71ca27985bb080d06f01bed52475447345, Accept-Language: mn

<p>Pay Qr Invoice of qrCode with card-token</p>
<p>card token is sent as a http-header 'x-card-token'</p>


Request body:
```
{
    "qrCode" : "BONUMQR82987247ddf95ed7e6e8531d4b84467bb6a492f055ddc0b59f2d26171bdc75be6772c229da9fc075cb78d35ca3865e7a8f22212c91bec30f5ee2664a149574cdeacdc46526d202a9b18be3a1caddedc21d73e8d2de592b3236651dc0ad10004b",
    "transactionId" : "v260427i123456789"
}
```

## Neo App



### Purchase
`GET `

<p>in-app.н backend.с</p>
<ol>
<li><p>token avna. // Authentication/Get Token</p>
</li>
<li><p>Invoice үүсгэнэ // Invoice/Create Invoice</p>
</li>
<li><p>Invoice.followuplink.г browser дуудна.</p>
</li>
</ol>
<p>in-app хэрэглэгч</p>
<ol>
<li>төлбөрийн сонголтоос сонгон төлбөрөө төлнө ( Only Neo visible)</li>
</ol>
<p>Neo App Backend (Payment Gateway).c</p>
<ol>
<li>in-app.н бүртгэлтэй мерчантын web-hook ruu төлбөрийн мэдээлэлийг дамжуулна.</li>
</ol>
<p>NOTE:</p>
<ol>
<li><p>in-app мерчантаар бүртгүүлнэ</p>
</li>
<li><p>web-hook бүртгүүлна</p>
</li>
</ol>


Request body:
```
// See documentations
```

### Get User Data
`GET {{M_CHAT_BASE_URL}}/users/apps/share/requests?requestId=b38685109fba4d98eae703c847ccc438e4ded1d643ce4cbc79e944ffa657eadc`



### Send Chat Message to Neo User
`POST {{NEO_BASE_URL}}/messages/send`



Request body:
```
{
    "phoneNumber" : "", // Neo User.n utasnii dugaar
    "message" : "Test Merchant Message ", // 
    "type" : "CHAT" // SMS | CHAT
}
```

## WebHook delievery



### WebHook хүлээн авах [ MN ]
`GET `

<p>Payment-Gateway.c мерчант руу гүйлгээний болон картын токены мэдээлэлийг дамжуулахдаа мерчантын бүртгүүлсэн webhook URL руу POST.р HTTP мессэж дамжуулдаг, Мөн хүсэлтийг баталжуулах checksum header.г илгээдэг</p>
<p>Жишээ:</p>
<p>merchant.н webhook url:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-html">https://abx-xyz.mn/abcd/webhook-receiver

</code></pre>
<p>request body:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "type" : "PAYMENT",
    "status" : "SUCCESS", //SUCCESS, FAILED
    "message" : "Амжилттай", // Successful, or anything, this could be changed anytime, DO NOT RELY ON ITS VALUE,
    "body" : {
        "invoiceId": "abc....xyz....", //invoice unique id
        "transactionId" : "", // 3rd party system's transcation id if the payment invoice was initiated with the 3rd party's transaction id
    }
}
эсвэл
{
    "type" : "CARD-TOKEN",
    "status" : "SUCCESS", //SUCCESS, FAILED
    "message" : "Амжилттай", // Successful, or anything, this could be changed anytime, DO NOT RELY ON ITS VALUE,
    "body" : {
        "token": "abc....xyz....", //invoice unique id
        "transactionId" : "", // 3rd party system's transcation id if the payment invoice was initiated with the 3rd party's transaction id
    }
}

</code></pre>


Request body:
```
/****

SEE documentations

**/
```

### WebHook receive [ EN ]
`GET `

<p>Payment-Gateway sends transaction info or card token to merchants webhook URL with HTTP POST message and checksum HEADER value which is used as a validation</p>
<p>Example:</p>
<p>merchant's webhook url:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-html">https://abx-xyz.mn/abcd/webhook-receiver

</code></pre>
<p>request body:</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "type" : "PAYMENT",
    "status" : "SUCCESS", //SUCCESS, FAILED
    "message" : "Амжилттай", // Successful, or anything, this could be changed anytime, DO NOT RELY ON ITS VALUE,
    "body" : {
        "invoiceId": "abc....xyz....", //invoice unique id
        "transactionId" : "", // 3rd party system's transcation id if the payment invoice was initiated with the 3rd party's transaction id
    }
}
эсвэл
{
    "type" : "CARD-TOKEN",
    "status" : "SUCCESS", //SUCCESS, FAILED
    "message" : "Амжилттай", // Successful, or anything, this could be changed anytime, DO NOT RELY ON ITS VALUE,
    "body" : {
        "token": "abc....xyz....", //invoice unique id
        "transactionId" : "", // 3rd party system's transcation id if the payment invoice was initiated with the 3rd party's transaction id
    }
}

</code></pre>


Request body:
```
/****

SEE documentations

**/
```

### WebHook Checksum [ MN ]
`GET `

<p>Доор кодыг ашиглан webhook хүлээн авах үед баталгаажуулалт хийгээрэй.</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-kotlin">fun checksumValidation(httpRequest : HttpRequest) : Boolean {
    val MERCHANT_CHECKSUM_KEY = "" // this will be provided by offline or email from bonum. this MUST be kept in secure. 
    val raw = JSON.toJson(value = httpRequest.requestBody, prettyPrint = false)
    val checksumValue = checksum(raw, MERCHANT_CHECKSUM_KEY)
    val checksumHeaderValue = httpRequest.headers.get('x-checksum-v2')
    val valid : Boolean = Objects.equals(checksumValue, checksumHeaderValue)
    return valid
}
fun checksum(value : String, key : String) : String {
    val secretKey = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256")
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(secretKey)
    val hmacArray = mac.doFinal(value.toByteArray(Charsets.UTF_8))
    //to Hex
    val checksum = this.hex(hmacArray)
    return checksum
}
private fun hex(vl : ByteArray) : String {
    val sb = StringBuilder(vl.size * 2)
    for(b in vl) {
        sb.append(String.format("x", b.toInt() and 0xff))
    }
    return sb.toString()
} 

</code></pre>


Request body:
```
/****

SEE documentations

**/
```

### WebHook Checksum [ EN ]
`GET `

<p>The code below is for checksum validation.</p>
<p>You ask MERCHANT_CHECKSUM_KEY from the Payment-Gateway admin.</p>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-kotlin">fun checksumValidation(httpRequest : HttpRequest) : Boolean {
    val MERCHANT_CHECKSUM_KEY = "" // this will be provided by offline or email from bonum. this MUST be kept in secure. 
    val raw = JSON.toJson(value = httpRequest.requestBody, prettyPrint = false) // no indentation
    val checksumValue = checksum(raw, MERCHANT_CHECKSUM_KEY)
    val checksumHeaderValue = httpRequest.headers.get('x-checksum-v2')
    val valid : Boolean = Objects.equals(checksumValue, checksumHeaderValue)
    return valid
}
fun checksum(value : String, key : String) : String {
    val secretKey = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256")
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(secretKey)
    val hmacArray = mac.doFinal(value.toByteArray(Charsets.UTF_8))
    //to Hex
    val checksum = this.hex(hmacArray)
    return checksum
}
private fun hex(vl : ByteArray) : String {
    val sb = StringBuilder(vl.size * 2)
    for(b in vl) {
        sb.append(String.format("x", b.toInt() and 0xff))
    }
    return sb.toString()
} 

</code></pre>


Request body:
```
/****

SEE documentations

**/
```

### Webhook Messages
`POST `



Example response (Online Payment Webhook Message (Success), None):
```

```

Example response (Online Payment Webhook Message (Failure), None):
```

```

Example response (Online Payment Webhook Message (Failure Card Payment Processing), None):
```

```

Example response (Card Tokenization Request Webhook Message (Success), None):
```

```

Example response (Card Tokenization Request Webhook Message (Failure), None):
```

```

## AppClips



### Get AppClip Link
`GET {{API_BASE_URL}}/bonum-gateway/appclips/:cardId`

Headers: Accept-Language: mn


