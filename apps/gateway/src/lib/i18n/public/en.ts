import type { PublicMessages } from './mn';

export const en: PublicMessages = {
	'lang.label': 'Language',

	'pay.title': 'Pay',
	'pay.banks': 'Choose your bank app',
	'pay.orBanks': 'or choose your bank app',
	'pay.scan': 'Scan the QR code with your bank app',
	'pay.showQr': 'Show a QR code to scan from another phone',
	'pay.qrAlt': 'QR code for this payment',
	'pay.waiting': 'Waiting for payment',
	'pay.expiresIn': 'Pay within {time}',
	'pay.checkNow': "I've paid: check",
	'pay.checking': 'Checking…',
	'pay.notYet': 'Not received yet',
	'pay.more': 'More',
	'pay.moreCount': '{count} banks',

	'state.paid.title': 'Payment successful',
	'state.paid.at': 'Paid {time}',
	'state.returning': 'Taking you back…',
	'state.returnNow': 'Return now',
	'state.back': 'Back to {name}',
	'state.confirming': 'Confirming your payment…',
	'state.slow.title': 'This is taking longer than usual',
	'state.slow.body': 'You can safely go back. {name} is told automatically when the payment arrives.',
	'state.expired.title': 'This payment link has expired',
	'state.expired.body': 'Go back to {name} to start again.',
	'state.failed.title': "Payment didn't go through",
	'state.failed.body': 'Go back to {name} to try again.',
	'state.cancelled.title': 'This payment was cancelled',
	'state.cancelled.body': 'Go back to {name} if you still want to pay.',

	'sandbox': 'Test payment: no real money moves',
	'support.label': 'Help',
	'support.site': 'Support site',
	'footer.secured': 'Secure payment',
	'footer.invoice': 'Invoice {id}',
	'money.label': '{amount} tugrik',

	'error.notFound.title': 'Payment not found',
	'error.pageNotFound.title': 'Page not found',
	'error.notFound.body': 'Check the link, or go back and start again.',
	'error.generic.title': 'Something went wrong',
	'error.generic.body': 'Wait a moment and try again.',
	'error.retry': 'Try again'
};
