export const enum ShapeFlags {
  ELEMENT = 1,
  FUNCTIONAL_COMPONENT = 1 << 1,
  // 表示VNode是一个有状态的组件
  STATEFUL_COMPONENT = 1 << 2,
  // 表示VNode的子节点是文本
  TEXT_CHILDREN = 1 << 3,
  ARRAY_CHILDREN = 1 << 4,
  // 表示VNode的子节点是一个数组
  SLOTS_CHILDREN = 1 << 5,
  TELEPORT = 1 << 6,
  SUSPENSE = 1 << 7,
  COMPONENT_SHOULD_KEEP_ALIVE = 1 << 8,
  // 表示组件已被缓存
  COMPONENT_KEPT_ALIVE = 1 << 9,
  // 表示VNode是一个组件（可以是函数式或有状态）
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT
}
