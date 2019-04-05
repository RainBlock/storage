mainAsync = async () => {
  // await mainSync();
  console.log(100000 * 2 * 2 * 4);
  return 100000 * 2 * 2 * 4;
}


const mainSync = async () => {
  console.log("true");
  return true;
}

mainAsync()
mainSync()
