import type { PublicMessages } from './mn';

export const zhHans: PublicMessages = {
	'lang.label': '语言',

	'pay.title': '付款',
	'pay.to': '收款方',
	'pay.banks': '选择您的银行应用',
	'pay.orBanks': '或选择您的银行应用',
	'pay.scan': '请用银行应用扫描二维码',
	'pay.showQr': '显示二维码，用另一部手机扫描',
	'pay.qrAlt': '本次付款的二维码',
	'pay.waiting': '等待付款',
	'pay.expiresIn': '请在 {time} 内付款',
	'pay.checkNow': '我已付款，查询',
	'pay.checking': '正在查询…',
	'pay.notYet': '尚未收到付款',

	'state.paid.title': '付款成功',
	'state.paid.at': '付款时间：{time}',
	'state.returning': '正在返回…',
	'state.returnNow': '立即返回',
	'state.back': '返回 {name}',
	'state.confirming': '正在确认您的付款…',
	'state.slow.title': '耗时比平常更久',
	'state.slow.body': '您可以放心返回。款项到账后，{name} 会自动收到通知。',
	'state.expired.title': '付款链接已过期',
	'state.expired.body': '请返回 {name} 重新开始。',
	'state.failed.title': '付款未成功',
	'state.failed.body': '请返回 {name} 重试。',
	'state.cancelled.title': '付款已取消',
	'state.cancelled.body': '如仍需付款，请返回 {name}。',

	'sandbox': '测试付款：不会产生真实扣款',
	'support.label': '帮助',
	'support.site': '支持网站',
	'footer.secured': '安全付款',
	'footer.invoice': '账单 {id}',
	'money.label': '{amount} 图格里克',

	'error.notFound.title': '未找到该付款',
	'error.notFound.body': '请检查链接，或返回后重新开始。',
	'error.generic.title': '出错了',
	'error.generic.body': '请稍候再试。',
	'error.retry': '重试'
};
