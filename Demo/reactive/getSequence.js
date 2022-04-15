// [1,3,6,7,9,4,10,5,6];
let b =[1,3,6,7,9,4,10,5,6]
b = [2, 1, 5, 3, 6, 4, 8, 9, 7];
b =  [1,2,4,3,6,5,7];
//简直就是妙脆角
//1,5,6
function getSequence(arr) {
//  存放满足最长递增子序列的下标，默认值为0
  let result = [0]
  let p = arr.slice()
  const len = arr.length
  let i, j, left, right, center
  for (let i = 0; i < len; i++) {
    const current = arr[i]
    j = result[result.length - 1]
    // 当前元素比已经收集到的最后一个元素还大，那就放进去
    if (current > arr[j]) {
      //并临时记录下满足当前元素递增子序列的上一个元素的下标 ，这个后面可能会变。
      p[i] = j ;
      result.push(i)
      continue
    }
   left= 0;
    right = result.length-1;
    while(left<right){
      center = left+right >>1;
      if(current > arr[result[center]]){
        left = center+1;
      }else {
        right = center
      }
    }
    //交换位置
    if(current<arr[result[left]]){
      if(left>0){
        p[i] = result[left-1]
      }
      result[left] = i;
    }

  }
  left = result.length;
  right = result[left-1];
  while(left-->0){
    result[left] = right;
    right = p[right]
  }

  console.log('这里是 result 的结果-------------', result)
  return result;

}

getSequence(b);
