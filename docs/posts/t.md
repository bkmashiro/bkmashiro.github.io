```javascript
const getUserName = (id) => {
	try {
        const uname = perform 'user_name';
    } handle (effect) {
        if (effect === 'user_name') {
            const resp = await fetch(`uname/${id}`);
            resume resp;
        }
    }
}
```

```javascript
const getUserName = (userId) => doSthToGetUserName(userId);

const main = () => {
  const userName = getUserName(123);
  console.log(userName);
};
```

```javascript
const getUserName = async (userId) => (await axios.get(`${userId}`)).data;

const main = async () => {
  const userName = await getUserName(123);
  console.log(userName);
};
```

