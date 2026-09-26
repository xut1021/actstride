const base = { keyword: '传感器', target: 'S-102', name: '测试员', quantity: '2', delay: 0, retry: false, shifted: false };
export const scenarios = {
  baseline: { ...base },
  alternate: { ...base, keyword: '电机', target: 'M-201', name: '林禾', quantity: '3' },
  shifted: { ...base, name: '周宁', quantity: '4', shifted: true },
  delayed: { ...base, delay: 1800 },
  recovery: { ...base, retry: true },
};
export function taskFor(s) {
  return `搜索“${s.keyword}”，筛选“有库存”，选择价格不超过 100 元的型号；填写姓名“${s.name}”、数量“${s.quantity}”，核对确认弹窗并提交。以页面显示 PASS 为完成。`;
}
