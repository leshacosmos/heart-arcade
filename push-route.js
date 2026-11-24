function pushRoute(page, anchor) {
  const validPages = ['home', 'quests', 'shop', 'coupons'];
  const prefix = {shop: /^(wish-[0-9a-f-]{36}|reward-\d+)$/, coupons: /^coupon-[0-9a-f-]{36}$/, quests: /^quest-[0-9a-f-]{36}$/};
  return {
    page: validPages.includes(page) ? page : 'home',
    anchor: typeof anchor === 'string' && validPages.includes(page) && prefix[page]?.test(anchor) ? anchor : ''
  };
}
