import type { PublicMessages } from './mn';

export const ru: PublicMessages = {
	'lang.label': 'Язык',

	'pay.title': 'Оплата',
	'pay.banks': 'Выберите приложение банка',
	'pay.orBanks': 'или выберите приложение банка',
	'pay.scan': 'Отсканируйте QR-код в приложении банка',
	'pay.showQr': 'Показать QR-код для сканирования с другого телефона',
	'pay.qrAlt': 'QR-код этого платежа',
	'pay.waiting': 'Ожидаем оплату',
	'pay.expiresIn': 'Оплатите в течение {time}',
	'pay.checkNow': 'Я оплатил: проверить',
	'pay.checking': 'Проверяем…',
	'pay.notYet': 'Оплата ещё не поступила',
	'pay.more': 'Ещё',
	'pay.moreCount': 'банков: {count}',

	'state.paid.title': 'Оплата прошла успешно',
	'state.paid.at': 'Оплачено {time}',
	'state.returning': 'Возвращаем вас…',
	'state.returnNow': 'Вернуться сейчас',
	'state.back': 'Вернуться в {name}',
	'state.confirming': 'Подтверждаем оплату…',
	'state.slow.title': 'Это занимает больше времени, чем обычно',
	'state.slow.body': 'Можно спокойно вернуться: {name} получит уведомление, когда платёж поступит.',
	'state.expired.title': 'Срок действия ссылки истёк',
	'state.expired.body': 'Вернитесь в {name} и начните заново.',
	'state.failed.title': 'Оплата не прошла',
	'state.failed.body': 'Вернитесь в {name} и попробуйте ещё раз.',
	'state.cancelled.title': 'Платёж отменён',
	'state.cancelled.body': 'Если вы всё ещё хотите оплатить, вернитесь в {name}.',

	'sandbox': 'Тестовый платёж: реальные деньги не списываются',
	'support.label': 'Помощь',
	'support.site': 'Сайт поддержки',
	'footer.secured': 'Безопасная оплата',
	'footer.invoice': 'Счёт {id}',
	'money.label': 'Сумма в тугриках: {amount}',

	'error.notFound.title': 'Платёж не найден',
	'error.pageNotFound.title': 'Страница не найдена',
	'error.notFound.body': 'Проверьте ссылку или вернитесь и начните заново.',
	'error.generic.title': 'Что-то пошло не так',
	'error.generic.body': 'Подождите немного и попробуйте ещё раз.',
	'error.retry': 'Повторить'
};
