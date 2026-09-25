/**
 * Нийтийн хуудасны (/pay, /return, алдааны хуудас) монгол бичвэр. Анхдагч хэл.
 * Mongolian strings for the public pages: the default language, and the
 * source of the key set every other language must match.
 *
 * `{name}` is the brand the payer is paying, `{amount}` is `₮49,000` (in
 * `money.label`, the bare number `49,000`: the label names the unit). The
 * Mongolian text avoids case endings on `{name}` (-д/-т, руу/рүү depend on
 * the word), so sentences read correctly for any brand name.
 */
export const mn = {
	'lang.label': 'Хэл',

	'pay.title': 'Төлбөр төлөх',
	'pay.banks': 'Банкны апп-аа сонгоно уу',
	'pay.orBanks': 'эсвэл банкны апп-аа сонгоно уу',
	'pay.scan': 'QR кодыг банкны апп-аараа уншуулна уу',
	'pay.showQr': 'Өөр утаснаас уншуулах QR код',
	'pay.qrAlt': 'Энэ төлбөрийн QR код',
	'pay.waiting': 'Төлбөр хүлээж байна',
	'pay.expiresIn': '{time} дотор төлнө үү',
	'pay.checkNow': 'Төлсөн, шалгах',
	'pay.checking': 'Шалгаж байна…',
	'pay.notYet': 'Төлбөр хараахан орж ирээгүй байна',

	'state.paid.title': 'Төлбөр амжилттай',
	'state.paid.at': 'Төлсөн: {time}',
	'state.returning': 'Удахгүй буцаан шилжүүлнэ…',
	'state.returnNow': 'Одоо буцах',
	'state.back': 'Буцах',
	'state.confirming': 'Төлбөрийг баталгаажуулж байна…',
	'state.slow.title': 'Ердийнхөөс удаж байна',
	'state.slow.body': 'Та буцаж болно. Төлбөр орж ирэхэд худалдагчид автоматаар мэдэгдэнэ.',
	'state.expired.title': 'Хугацаа дууссан',
	'state.expired.body': 'Энэ төлбөрийн холбоосын хугацаа дууссан. Буцаад дахин эхлүүлнэ үү.',
	'state.failed.title': 'Төлбөр амжилтгүй боллоо',
	'state.failed.body': 'Буцаад дахин оролдоно уу.',
	'state.cancelled.title': 'Төлбөр цуцлагдсан',
	'state.cancelled.body': 'Төлөх бол буцаад дахин эхлүүлнэ үү.',

	'sandbox': 'Туршилтын төлбөр: бодит мөнгө шилжихгүй',
	'support.label': 'Тусламж',
	'support.site': 'Тусламжийн хуудас',
	'footer.secured': 'Аюулгүй төлбөр',
	'footer.invoice': 'Нэхэмжлэх {id}',
	'money.label': '{amount} төгрөг',

	'error.notFound.title': 'Төлбөр олдсонгүй',
	'error.pageNotFound.title': 'Хуудас олдсонгүй',
	'error.notFound.body': 'Холбоосоо шалгах эсвэл буцаад дахин эхлүүлнэ үү.',
	'error.generic.title': 'Алдаа гарлаа',
	'error.generic.body': 'Хэсэг хүлээгээд дахин оролдоно уу.',
	'error.retry': 'Дахин оролдох'
};

export type PublicKey = keyof typeof mn;
/** Every language file has exactly these keys: a missing or extra key fails `pnpm check`. */
export type PublicMessages = { [K in PublicKey]: string };
