import React, { createContext, useContext, useState, useEffect, useEffectEvent, useRef } from 'react';
import { ethers } from 'ethers';
import config from '../config.json';

const BlockchainContext = createContext();

const contractAddress = config.contractAddress;
const contractABI = config.abi;
const WALLET_STORAGE_KEY = "pharmachain.wallet";

const getLegacyWalletOptions = () => {
  if (typeof window === "undefined") return [];
  const seen = new Set();
  const options = [];
  const addProvider = (provider) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    const id = provider.isMetaMask ? "metamask" : `wallet-${seen.size}`;
    const label = provider.isMetaMask ? "MetaMask" : "Wallet";
    options.push({ id, label, icon: null, provider });
  };
  const root = window.ethereum;
  if (Array.isArray(root?.providers)) {
    root.providers.forEach(addProvider);
  } else {
    addProvider(root);
  }
  return options;
};

export function BlockchainProvider({ children }) {
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [role, setRole] = useState(0);
  const [walletName, setWalletName] = useState("Wallet");
  const [selectedWalletId, setSelectedWalletId] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(WALLET_STORAGE_KEY);
  });

  const [eip6963Wallets, setEip6963Wallets] = useState([]);
  const eip6963Map = useRef(new Map());
  const connectingRef = useRef(false);

  useEffect(() => {
    const handleAnnounce = (event) => {
      const { info, provider } = event.detail;
      if (eip6963Map.current.has(info.uuid)) return;
      eip6963Map.current.set(info.uuid, {
        id: info.rdns ?? info.uuid,
        label: info.name,
        icon: info.icon ?? null,
        provider,
      });
      setEip6963Wallets([...eip6963Map.current.values()]);
    };
    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", handleAnnounce);
  }, []);

  // For useEvent safety with listeners
  const safeCheckConnection = () => {
    checkConnection();
  };

  const handleProviderChange = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    try {
      setProvider(null);
      setContract(null);
      setAccount("");
      setRole(0);
      await checkConnection();
    } finally {
      connectingRef.current = false;
    }
  };

  useEffect(() => {
    const allOptions = [
      ...eip6963Wallets,
      ...getLegacyWalletOptions().filter(
        (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
      ),
    ];
    const activeWallet = selectedWalletId
      ? allOptions.find((w) => w.id === selectedWalletId) ?? allOptions[0]
      : allOptions[0];
    const injectedProvider = activeWallet?.provider ?? null;

    safeCheckConnection();

    injectedProvider?.on?.("chainChanged", handleProviderChange);
    injectedProvider?.on?.("accountsChanged", handleProviderChange);

    return () => {
      injectedProvider?.removeListener?.("chainChanged", handleProviderChange);
      injectedProvider?.removeListener?.("accountsChanged", handleProviderChange);
    };
  }, [selectedWalletId, eip6963Wallets]);

  const checkConnection = async () => {
    if (typeof window !== "undefined" && !window.localStorage.getItem(WALLET_STORAGE_KEY)) {
      return;
    }
    const storedId = selectedWalletId;
    const allOptions = [
      ...eip6963Wallets,
      ...getLegacyWalletOptions().filter(
        (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
      ),
    ];
    const preferred = storedId ? allOptions.find((w) => w.id === storedId) ?? allOptions[0] : allOptions[0];
    const candidates = preferred ? [preferred, ...allOptions.filter((w) => w !== preferred)] : allOptions;

    for (const wallet of candidates) {
      try {
        const accounts = await wallet.provider.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          setWalletName(wallet.label);
          await connectWallet({ silent: true, injectedProvider: wallet.provider, preferredWallet: wallet.id, walletLabel: wallet.label });
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const connectWallet = async ({ silent = false, injectedProvider, preferredWallet, walletLabel } = {}) => {
    if (!injectedProvider) {
      const allOptions = [
        ...eip6963Wallets,
        ...getLegacyWalletOptions().filter(
          (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
        ),
      ];
      const found = preferredWallet ? allOptions.find((w) => w.id === preferredWallet) : allOptions[0];
      injectedProvider = found?.provider ?? null;
      walletLabel = walletLabel ?? found?.label ?? "Wallet";
    }
    if (!injectedProvider) return alert("Please install an EVM wallet such as MetaMask.");

    const connectedWalletName = walletLabel ?? "Wallet";
    const walletId = preferredWallet ?? "wallet";

    try {
      const accounts = await injectedProvider.request({
        method: silent ? "eth_accounts" : "eth_requestAccounts",
      });
      if (!accounts.length) return;

      setSelectedWalletId(walletId);
      if (typeof window !== "undefined" && walletId) {
        window.localStorage.setItem(WALLET_STORAGE_KEY, walletId);
      }
      setWalletName(connectedWalletName);

      const providerRaw = new ethers.BrowserProvider(injectedProvider);
      const signer = await providerRaw.getSigner(accounts[0]);
      const addr = await signer.getAddress();
      
      setProvider(providerRaw);
      setAccount(addr);
      
      const pContract = new ethers.Contract(contractAddress, contractABI, signer);
      setContract(pContract);

      try {
        const r = await pContract.getMyRole();
        setRole(Number(r));
      } catch {
        console.log("No role assigned");
      }
    } catch (err) {
      setProvider(null);
      setAccount("");
      setContract(null);
      setRole(0);
      console.error(err);
      if (!silent && err.code !== 4001) {
        alert(err.shortMessage || err.message || "Wallet connection failed.");
      }
    }
  };

  const connectHardhatDemo = async (roleIndex) => {
    try {
      const providerRaw = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const accounts = await providerRaw.listAccounts();
      if (!accounts[roleIndex]) throw new Error("Account missing.");
      
      const signer = await providerRaw.getSigner(accounts[roleIndex].address);
      const addr = await signer.getAddress();
      
      setWalletName("Hardhat Demo");
      setProvider(providerRaw);
      setAccount(addr);
      
      const pContract = new ethers.Contract(contractAddress, contractABI, signer);
      setContract(pContract);
      
      try {
        const r = await pContract.getMyRole();
        setRole(Number(r));
      } catch {
        console.log("No role assigned");
      }
    } catch (e) { console.error(e); alert("Failed Hardhat Demo. Is it running?"); }
  };

  const signOut = async () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
    }
    setSelectedWalletId(null);
    setProvider(null);
    setAccount("");
    setContract(null);
    setRole(0);
    setWalletName("Wallet");
  };

  const walletOptions = [
    ...eip6963Wallets.filter((w) => !w.id.includes("phantom")),
    ...getLegacyWalletOptions().filter(
      (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
    ),
  ];

  const registerRole = async (selectedRole) => {
    if (!contract || !account) {
      alert("Please connect wallet first");
      return;
    }
    try {
      const tx = await contract.registerUser(account, selectedRole);
      await tx.wait();
      alert("Role assigned successfully on the blockchain!");
      setRole(selectedRole);
    } catch (err) {
      console.error(err);
      alert("Error assigning role. Verify your contract state.");
    }
  };

  return (
    <BlockchainContext.Provider value={{
      provider,
      account,
      contract,
      role,
      setRole,
      walletName,
      walletOptions,
      connectWallet,
      connectHardhatDemo,
      signOut,
      registerRole
    }}>
      {children}
    </BlockchainContext.Provider>
  );
}

export const useBlockchain = () => useContext(BlockchainContext);
