const base = { keyword: '传感器', target: 'S-102', name: '测试员', quantity: '2', delay: 0, retry: false, shifted: false };
export const scenarios = {
  baseline: { ...base },
  alternate: { ...base, keyword: '电机', target: 'M-201', name: '林禾', quantity: '3' },
  shifted: { ...base, name: '周宁', quantity: '4', shifted: true },
  delayed: { ...base, delay: 1800 },
  recovery: { ...base, retry: true },
  tickets_a: { kind: 'tickets', department: '研发', priority: '紧急', owner: '周宁', task: '在工单列表中找到研发部门的紧急工单，打开它，将负责人设为周宁并确认分派。以 PASS 为完成。' },
  tickets_b: { kind: 'tickets', department: '财务', priority: '普通', owner: '林禾', task: '在工单列表中找到财务部门的普通工单，打开它，将负责人设为林禾并确认分派。以 PASS 为完成。' },
  booking_a: { kind: 'booking', day: '周二', period: '上午', capacity: 6, name: '陈青', task: '预约周二上午、至少容纳 6 人的可用会议室。填写申请人陈青，在确认弹窗核对后预约。以 PASS 为完成。' },
  booking_b: { kind: 'booking', day: '周三', period: '下午', capacity: 10, name: '许川', task: '预约周三下午、至少容纳 10 人的可用会议室。填写申请人许川，在确认弹窗核对后预约。以 PASS 为完成。' },
  settings_a: { kind: 'settings', email: true, sms: false, zone: '上海', task: '打开通知设置，将邮件通知设为开启、短信通知设为关闭，时区设为上海，然后保存并确认。以 PASS 为完成。' },
  settings_b: { kind: 'settings', email: false, sms: true, zone: '伦敦', task: '打开通知设置，将邮件通知设为关闭、短信通知设为开启，时区设为伦敦，然后保存并确认。以 PASS 为完成。' },
};
export function taskFor(s) {
  if (s.task) return s.task;
  return `搜索“${s.keyword}”，筛选“有库存”，选择价格不超过 100 元的型号；填写姓名“${s.name}”、数量“${s.quantity}”，核对确认弹窗并提交。以页面显示 PASS 为完成。`;
}
