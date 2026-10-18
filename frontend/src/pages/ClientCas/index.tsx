import { HasPermission } from "src/components";
import { ACCESS_LISTS, VIEW } from "src/modules/Permissions";
import TableWrapper from "./TableWrapper";

const ClientCas = () => {
	return (
		<HasPermission section={ACCESS_LISTS} permission={VIEW} pageLoading loadingNoLogo>
			<TableWrapper />
		</HasPermission>
	);
};

export default ClientCas;
