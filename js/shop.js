(function(){
  let products = [];
  let cart = [];
  const productsEl = document.querySelector('.products');
  const cartBar = document.getElementById('cartBar');
  const cartTotal = document.getElementById('cartTotal');
  const toastEl = document.getElementById('toast');

  function showToast(msg){
    toastEl.textContent