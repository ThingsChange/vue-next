// [1,3,6,7,9,4,10,5,6];
let b =[1,3,6,7,9,4,10,5,6]
b = [2, 1, 5, 3, 6, 4, 8, 9, 7];
// b =  [10,20,40,30,60,50,70];
//简直就是妙脆角
//1,5,6
function getSequence(arr) {
//  存放满足最长递增子序列的下标，默认值为0，在没有被修正顺序之前，我们希望这个最长递增子序列增长速度越慢越好
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
    //二分法找到第一个比当前值大的元素位置
    while(left<right){
      center = left+right >>1;
      if(current > arr[result[center]]){
        left = center+1;
      }else {
        right = center
      }
    }
    //交换位置    让最长递增子序列上升速度越慢越好
    if(current<arr[result[left]]){
      if(left>0){
        p[i] = result[left-1]
      }
      result[left] = i;
    }

  }
  console.log('这里是   result  ------没有调整前------', JSON.stringify(result))
  console.log('这里是   p  ------------', p)
  //因为result存储的是最慢递增子序列的下标，所以最后一位肯定是最长递增子序列中最大的，也就是说，最后一位的坐标是精准的。
  //right 变成当前位置的精准坐标。P总存储的是满足当前递增的上一个元素的下标
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
